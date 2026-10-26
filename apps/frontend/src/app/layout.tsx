import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import { Onest, Unbounded } from 'next/font/google';
import type { ReactNode } from 'react';
import '../styles/globals.css';
import { Providers } from '../components/Providers';
import { THEME_KEY } from '../lib/telegram';

const onest = Onest({
  subsets: ['latin', 'cyrillic', 'cyrillic-ext'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-onest',
  display: 'swap',
});
const unbounded = Unbounded({
  subsets: ['latin', 'cyrillic'],
  weight: ['500', '600', '700'],
  variable: '--font-unbounded',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'FICE Helper',
  description: 'Помічник академічних груп ФІОТ КПІ',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F3F4F9' },
    { media: '(prefers-color-scheme: dark)', color: '#0B0E1A' },
  ],
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="uk" className={`${onest.variable} ${unbounded.variable}`} suppressHydrationWarning>
      <head>
        <Script src="https://telegram.org/js/telegram-web-app.js" strategy="beforeInteractive" />
        {/* Apply the theme before first paint to avoid a light→dark flash. Same order as
            syncTheme(): stored override, then Telegram, then the OS preference. */}
        <Script id="theme-init" strategy="beforeInteractive">
          {`try{var t=null;try{t=localStorage.getItem('${THEME_KEY}')}catch(e){}var w=window.Telegram&&window.Telegram.WebApp;var d=t==='dark'||t!=='light'&&(w&&w.platform!=='unknown'?w.colorScheme==='dark':matchMedia('(prefers-color-scheme: dark)').matches);if(d)document.documentElement.classList.add('dark')}catch(e){}`}
        </Script>
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
