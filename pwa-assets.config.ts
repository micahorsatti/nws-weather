import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config';

// Brand tile color. The generator's defaults for the maskable and apple-touch icons are a
// white canvas with the artwork shrunk to 70%, which would frame the icon in white. Both
// outputs are overridden to fill edge to edge with this color instead.
const BRAND_BACKGROUND = '#0f172a';

export default defineConfig({
  preset: {
    ...minimal2023Preset,
    maskable: {
      sizes: [512],
      padding: 0,
      resizeOptions: { fit: 'contain', background: BRAND_BACKGROUND },
    },
    apple: {
      sizes: [180],
      padding: 0,
      resizeOptions: { fit: 'contain', background: BRAND_BACKGROUND },
    },
  },
  images: ['public/favicon.svg'],
});
