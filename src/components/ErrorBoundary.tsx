import * as React from 'react';

interface Props {
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Without this, any render error unmounts the whole tree and leaves a blank
 * white window with no indication of what went wrong. Showing the error keeps
 * a crash diagnosable instead of mysterious.
 */
export default class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Interface crashed:', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="min-h-screen bg-black text-white/80 font-mono p-8 flex flex-col items-center justify-center gap-6">
        <div className="w-full max-w-2xl border border-red-400/30 bg-red-400/5 rounded-lg p-6">
          <div className="text-[10px] tracking-widest font-display text-red-400/80 border-b border-red-400/20 pb-2 mb-4">
            SYS // INTERFACE FAULT
          </div>
          <p className="text-[12px] text-white/80 mb-3">{error.message}</p>
          <pre className="text-[9px] text-white/35 whitespace-pre-wrap max-h-52 overflow-y-auto custom-scrollbar">
            {error.stack}
          </pre>
        </div>
        <button
          onClick={() => this.setState({ error: null })}
          className="px-5 py-2 text-[10px] tracking-widest font-display uppercase border border-white/40 rounded text-white hover:bg-white/10 transition-colors"
        >
          Reload interface
        </button>
      </div>
    );
  }
}
