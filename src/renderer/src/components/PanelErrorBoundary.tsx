import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  name: string
  children: ReactNode
}

interface State {
  error: string | null
}

export class PanelErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error: error.message || 'Panel failed to render.' }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[${this.props.name}]`, error, info.componentStack)
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <section className="panel panel-fault">
        <h2>{this.props.name} fault</h2>
        <p>{this.state.error}</p>
        <button className="btn ghost" type="button" onClick={() => this.setState({ error: null })}>
          Retry panel
        </button>
      </section>
    )
  }
}
