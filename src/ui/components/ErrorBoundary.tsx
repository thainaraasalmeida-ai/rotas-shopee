import { Component, type ReactNode } from 'react';

/** Se uma tela quebrar, mostra o motivo e mantém os dados salvos (nada é apagado). */
export class ErrorBoundary extends Component<{ children: ReactNode; name: string }, { error?: Error }> {
  state: { error?: Error } = {};
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (!this.state.error) return this.props.children;
    return <div className="screen stack">
      <div className="ss-near-warn" role="alert">A tela {this.props.name} encontrou um erro. Seus dados continuam salvos.</div>
      <code className="small" style={{ whiteSpace: 'pre-wrap' }}>{this.state.error.message}</code>
      <button className="ss-btn go" onClick={() => location.reload()}>Recarregar a ShoSho</button>
      <span className="small muted">Se continuar, mande um print desta tela.</span>
    </div>;
  }
}
