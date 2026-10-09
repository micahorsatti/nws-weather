/**
 * The imperative Leaflet side of the radar view: map, basemap, preloaded radar frame layers, alert
 * polygons, and the location marker. RadarView.tsx drives it; nothing else imports Leaflet.
 *
 * Frame layers are all added to the map up front at opacity 0 so their tiles preload, and the view just
 * switches which one is opaque. That keeps animation flicker-free.
 */
import * as L from 'leaflet';
import { alertStyle, popupText } from './alerts';
import type { AlertShape } from './alerts';
import { basemapFor } from './basemap';
import type { RadarFrame, RadarSource } from './frames';
import { wmsEndpoint } from './region';
import type { Theme } from './theme';
import type { AlertGeometry } from '../../data/types';

export const RADAR_OPACITY = 0.7;
export const DEFAULT_ZOOM = 7;
const MIN_ZOOM = 3;
const MAX_ZOOM = 11;
/** WMS tiles are fetched at 512 px: a quarter of the requests of 256 px tiles for the same screen. */
const WMS_TILE_SIZE = 512;

const PANE_RADAR = 'rv-radar';
const PANE_LABELS = 'rv-labels';

export interface MapCallbacks {
  /** The set of frame ids whose tiles are all loaded changed. */
  onReadyChange: (ready: ReadonlySet<string>) => void;
  /** Every tile request of a frame failed (and none succeeded). */
  onFrameFailed: (frameId: string) => void;
}

export interface MapOptions {
  lat: number;
  lon: number;
  theme: Theme;
  /** Turn off Leaflet's pan/zoom/fade animations. */
  reducedMotion: boolean;
  callbacks: MapCallbacks;
}

interface FrameLayer {
  frame: RadarFrame;
  layer: L.TileLayer;
  /** All tiles of the latest loading round are in (successfully or not). */
  ready: boolean;
  loaded: number;
  errors: number;
  /** No longer in the frame list; removed once it is no longer on screen. */
  retired: boolean;
}

const HERE_ICON = L.divIcon({
  className: 'rv-here',
  html: '<span class="rv-here-pulse"></span><span class="rv-here-dot"></span>',
  iconSize: [28, 28],
});

const LOCATE_SVG =
  '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

/** GeoJSON [lon, lat] rings to Leaflet [lat, lon] rings; one polygon per entry. */
function toLatLngs(geometry: AlertGeometry): L.LatLngTuple[][][] {
  const ring = (r: number[][]): L.LatLngTuple[] => r.map((p) => [p[1] as number, p[0] as number]);
  const polygon = (rings: number[][][]): L.LatLngTuple[][] => rings.map(ring);
  return geometry.type === 'Polygon'
    ? [polygon(geometry.coordinates as number[][][])]
    : (geometry.coordinates as number[][][][]).map(polygon);
}

export class RadarMapController {
  private readonly map: L.Map;
  private readonly cb: MapCallbacks;
  private readonly marker: L.Marker;
  private readonly alertGroup: L.LayerGroup;
  private readonly resizeObserver: ResizeObserver | null;
  private readonly reducedMotion: boolean;

  private home: L.LatLng;
  private theme: Theme;
  private base: L.TileLayer | null = null;
  private labels: L.TileLayer | null = null;
  private shapes: readonly AlertShape[] = [];

  private readonly layers = new Map<string, FrameLayer>();
  private current: FrameLayer | null = null;
  /** The previously shown frame, kept visible until the newly selected one has painted. */
  private lingering: FrameLayer | null = null;
  private readySignature = '';
  private popupOpen = false;
  private destroyed = false;

  constructor(container: HTMLElement, options: MapOptions) {
    this.cb = options.callbacks;
    this.theme = options.theme;
    this.reducedMotion = options.reducedMotion;
    this.home = L.latLng(options.lat, options.lon);

    const motion = !options.reducedMotion;
    this.map = L.map(container, {
      center: this.home,
      zoom: DEFAULT_ZOOM,
      minZoom: MIN_ZOOM,
      maxZoom: MAX_ZOOM,
      zoomControl: false,
      attributionControl: false,
      zoomAnimation: motion,
      fadeAnimation: motion,
      markerZoomAnimation: motion,
      maxBounds: L.latLngBounds([-85, -180], [85, 180]),
      maxBoundsViscosity: 0.8,
      tapTolerance: 15,
    });

    // Radar sits between the basemap (tile pane, z 200) and the alert polygons (overlay pane, z 400);
    // place-name labels go above the polygons so they stay readable.
    this.map.createPane(PANE_RADAR).style.zIndex = '250';
    this.map.createPane(PANE_LABELS).style.zIndex = '450';

    L.control.zoom({ position: 'topright', zoomInTitle: 'Zoom in', zoomOutTitle: 'Zoom out' }).addTo(this.map);
    this.addLocateControl();

    this.alertGroup = L.layerGroup().addTo(this.map);
    this.marker = L.marker(this.home, { icon: HERE_ICON, interactive: false, keyboard: false, zIndexOffset: 500 }).addTo(this.map);

    this.map.on('popupopen', () => {
      this.popupOpen = true;
    });
    this.map.on('popupclose', () => {
      this.popupOpen = false;
    });

    const el = this.map.getContainer();
    el.setAttribute('role', 'group');
    el.setAttribute('aria-roledescription', 'map');
    el.setAttribute('aria-label', 'Radar map. Use the arrow keys to pan and plus and minus to zoom.');

    this.setTheme(options.theme);

    // The overlay's size can change after mount (safe areas, rotation, the controls bar); keep Leaflet in sync.
    this.resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(() => this.invalidateSize()) : null;
    this.resizeObserver?.observe(container);
  }

  // --- basemap ------------------------------------------------------------------------------------------

  /** Switch (or first set) the basemap for a theme. The old tiles stay until the new ones have loaded. */
  setTheme(theme: Theme): void {
    if (this.destroyed) return;
    if (this.base && theme === this.theme) return;
    this.theme = theme;
    const spec = basemapFor(theme);
    const base = L.tileLayer(spec.base.url, {
      pane: 'tilePane',
      noWrap: true,
      maxZoom: MAX_ZOOM,
      maxNativeZoom: spec.base.maxNativeZoom,
      className: 'rv-basemap',
    }).addTo(this.map);
    const labels = L.tileLayer(spec.labels.url, {
      pane: PANE_LABELS,
      noWrap: true,
      maxZoom: MAX_ZOOM,
      maxNativeZoom: spec.labels.maxNativeZoom,
      className: 'rv-labels',
    }).addTo(this.map);
    this.retireWhenLoaded(this.base, base);
    this.retireWhenLoaded(this.labels, labels);
    this.base = base;
    this.labels = labels;
    this.renderAlerts(); // polygon colors depend on the theme
  }

  private retireWhenLoaded(old: L.TileLayer | null, next: L.TileLayer): void {
    if (!old) return;
    const remove = () => {
      if (!this.destroyed && this.map.hasLayer(old)) this.map.removeLayer(old);
    };
    next.once('load', remove);
    window.setTimeout(remove, 5000); // never keep two basemaps if the new tiles stall
  }

  /** Close any open alert popup. Returns whether one was open (Escape closes it before the dialog). */
  closePopup(): boolean {
    if (this.destroyed || !this.popupOpen) return false;
    this.map.closePopup();
    return true;
  }

  // --- location -----------------------------------------------------------------------------------------

  /** Move the location marker; recenter the map on it unless told not to. */
  setLocation(lat: number, lon: number, recenter = true): void {
    if (this.destroyed) return;
    this.home = L.latLng(lat, lon);
    this.marker.setLatLng(this.home);
    if (recenter) this.map.setView(this.home, DEFAULT_ZOOM, { animate: false });
  }

  /** Back to the location at the default zoom. */
  recenter(): void {
    if (this.destroyed) return;
    this.map.setView(this.home, DEFAULT_ZOOM, { animate: !this.reducedMotion });
  }

  private addLocateControl(): void {
    const control = new L.Control({ position: 'topright' });
    control.onAdd = () => {
      const bar = L.DomUtil.create('div', 'leaflet-bar rv-locate');
      const link = L.DomUtil.create('a', 'rv-locate-btn', bar) as HTMLAnchorElement;
      link.href = '#';
      link.title = 'Center map on my location';
      link.setAttribute('role', 'button');
      link.setAttribute('aria-label', 'Center map on my location');
      link.innerHTML = LOCATE_SVG; // static markup, no data involved
      L.DomEvent.disableClickPropagation(bar);
      L.DomEvent.on(link, 'click', (e) => {
        L.DomEvent.preventDefault(e);
        this.recenter();
      });
      return bar;
    };
    control.addTo(this.map);
  }

  // --- alerts -------------------------------------------------------------------------------------------

  setAlerts(shapes: readonly AlertShape[]): void {
    if (this.destroyed) return;
    this.shapes = shapes;
    this.renderAlerts();
  }

  private renderAlerts(): void {
    this.alertGroup.clearLayers();
    for (const shape of this.shapes) {
      try {
        L.polygon(toLatLngs(shape.geometry), { ...alertStyle(shape.severity, this.theme), bubblingMouseEvents: false })
          .bindPopup(() => this.popupContent(shape), { maxWidth: 260, autoPanPaddingTopLeft: [16, 72], autoPanPaddingBottomRight: [16, 16] })
          .addTo(this.alertGroup);
      } catch {
        // One malformed polygon must not take the map down.
      }
    }
  }

  private popupContent(shape: AlertShape): HTMLElement {
    const { title, detail } = popupText(shape, Date.now());
    const root = document.createElement('div');
    root.className = 'rv-popup';
    const heading = document.createElement('strong');
    heading.textContent = title; // textContent: alert text is never parsed as HTML
    root.append(heading);
    if (detail) {
      const line = document.createElement('div');
      line.className = 'rv-popup-detail';
      line.textContent = detail;
      root.append(line);
    }
    return root;
  }

  // --- radar frames -------------------------------------------------------------------------------------

  /**
   * Make these the frames on the map. Layers for frames already present are reused (so a refresh only
   * loads what is new); layers no longer wanted are removed, except the one on screen, which stays until
   * showFrame replaces it. A null source or an empty list clears the radar entirely.
   */
  setFrames(source: RadarSource | null, frames: readonly RadarFrame[]): void {
    if (this.destroyed) return;
    if (!source || frames.length === 0) {
      // Nothing to show (an error state): drop the on-screen frame too, or it would stay up forever.
      this.current = null;
      this.lingering = null;
      frames = [];
    }
    const wanted = new Set(frames.map((f) => f.id));
    for (const fl of [...this.layers.values()]) {
      if (!wanted.has(fl.frame.id)) this.retire(fl);
    }
    // Newest first: its tiles are requested first and it is the frame people look at first.
    for (let i = frames.length - 1; i >= 0; i--) {
      const frame = frames[i] as RadarFrame;
      const existing = this.layers.get(frame.id);
      if (existing) existing.retired = false;
      else if (source) this.layers.set(frame.id, this.createFrameLayer(source, frame));
    }
    this.emitReady();
  }

  /** Show one frame (opacity RADAR_OPACITY) and hide the rest. A no-op for unknown ids. */
  showFrame(frameId: string): void {
    if (this.destroyed) return;
    const next = this.layers.get(frameId);
    if (!next || next.retired || next === this.current) return;
    const prev = this.current;
    const stale = this.lingering;
    this.current = next;
    this.lingering = null;
    if (stale && stale !== next) this.hide(stale);
    next.layer.setOpacity(RADAR_OPACITY);
    if (!prev) return;
    if (next.ready) {
      this.hide(prev);
      return;
    }
    // The new frame has not painted yet: keep the old one up so the screen never goes blank.
    this.lingering = prev;
    next.layer.once('load', () => {
      if (this.lingering === prev) {
        this.lingering = null;
        this.hide(prev);
      }
    });
  }

  isReady(frameId: string): boolean {
    const fl = this.layers.get(frameId);
    return !!fl && fl.ready && !fl.retired;
  }

  private createFrameLayer(source: RadarSource, frame: RadarFrame): FrameLayer {
    const common: L.TileLayerOptions = {
      pane: PANE_RADAR,
      opacity: 0,
      noWrap: true,
      keepBuffer: 1,
      maxZoom: MAX_ZOOM,
      className: 'rv-radar-layer',
    };
    let layer: L.TileLayer;
    if (source.kind === 'wms') {
      // `time` is not in @types/leaflet's WMSOptions, but Leaflet forwards unknown options as WMS params.
      const options: L.WMSOptions & { time: string } = {
        ...common,
        layers: source.region.layer,
        styles: '',
        format: 'image/png',
        transparent: true,
        version: '1.3.0',
        tileSize: WMS_TILE_SIZE,
        time: frame.param,
      };
      layer = L.tileLayer.wms(wmsEndpoint(source.region), options);
    } else {
      layer = L.tileLayer(frame.param, common);
    }

    const fl: FrameLayer = { frame, layer, ready: false, loaded: 0, errors: 0, retired: false };
    layer.on('loading', () => {
      if (this.destroyed) return;
      fl.ready = false;
      fl.loaded = 0;
      fl.errors = 0;
      this.emitReady();
    });
    layer.on('tileload', () => {
      fl.loaded += 1;
    });
    layer.on('tileerror', () => {
      fl.errors += 1; // handled quietly; only a total failure is reported
    });
    layer.on('load', () => {
      if (this.destroyed) return;
      fl.ready = true;
      this.emitReady();
      if (fl.errors > 0 && fl.loaded === 0) this.cb.onFrameFailed(frame.id);
    });
    layer.addTo(this.map);
    return fl;
  }

  private retire(fl: FrameLayer): void {
    fl.retired = true;
    if (fl !== this.current && fl !== this.lingering) this.dispose(fl);
  }

  private hide(fl: FrameLayer): void {
    fl.layer.setOpacity(0);
    if (fl.retired && fl !== this.current && fl !== this.lingering) this.dispose(fl);
  }

  private dispose(fl: FrameLayer): void {
    // Remove from the map first: that fires the layer's own 'remove' event, which is how Leaflet detaches
    // the layer's map listeners. Calling layer.off() first would strand them and the next map event
    // (a pan, a zoom) would throw inside the removed layer.
    this.map.removeLayer(fl.layer);
    fl.layer.off();
    this.layers.delete(fl.frame.id);
  }

  private emitReady(): void {
    if (this.destroyed) return;
    const ready = [...this.layers.values()].filter((fl) => fl.ready && !fl.retired).map((fl) => fl.frame.id);
    const signature = ready.sort().join('|');
    if (signature === this.readySignature) return;
    this.readySignature = signature;
    this.cb.onReadyChange(new Set(ready));
  }

  // --- lifecycle ----------------------------------------------------------------------------------------

  invalidateSize(): void {
    if (this.destroyed) return;
    // pan: true keeps the same ground at the center when the overlay is resized or rotated.
    this.map.invalidateSize({ animate: false, pan: true });
  }

  /** Tear everything down: observers, listeners, layers, tile requests. Safe to call twice. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true; // from here on every Leaflet callback below is a no-op
    this.resizeObserver?.disconnect();
    this.layers.clear();
    this.current = null;
    this.lingering = null;
    this.map.remove();
  }
}
