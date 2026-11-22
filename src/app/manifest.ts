import type { MetadataRoute } from 'next';
export default function manifest(): MetadataRoute.Manifest {
  return { name: 'Dong Gas', short_name: 'Dong Gas', description: 'Secure gas station shift and cash audit', start_url: '/', scope: '/', display: 'standalone', background_color: '#071525', theme_color: '#071525', icons: [{ src: '/icon', sizes: '512x512', type: 'image/png', purpose: 'any' }, { src: '/icon', sizes: '512x512', type: 'image/png', purpose: 'maskable' }] };
}
