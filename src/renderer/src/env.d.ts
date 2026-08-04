import type { AlbertApi } from '../../shared/api'

declare global {
  interface Window {
    albert: AlbertApi
  }

  namespace JSX {
    interface IntrinsicElements {
      webview: React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          src?: string
          partition?: string
          allowpopups?: string
        },
        HTMLElement
      >
    }
  }
}

export {}
