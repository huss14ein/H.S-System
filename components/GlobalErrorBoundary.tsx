import React from 'react';
import SectionCard from './SectionCard';

interface GlobalErrorBoundaryProps {
  children: React.ReactNode;
}

interface GlobalErrorBoundaryState {
  hasError: boolean;
  message: string | null;
}

class GlobalErrorBoundary extends React.Component<GlobalErrorBoundaryProps, GlobalErrorBoundaryState> {
  state: GlobalErrorBoundaryState = {
    hasError: false,
    message: null,
  };

  static getDerivedStateFromError(error: unknown): GlobalErrorBoundaryState {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : 'Unexpected application error.',
    };
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="min-h-screen bg-slate-50 p-6 sm:p-10">
        <div className="max-w-3xl mx-auto">
          <SectionCard title="System recovery mode" className="border-amber-200 bg-amber-50/60">
            <p className="text-sm text-amber-900">
              A runtime error occurred. We blocked a full white-screen crash and preserved a safe recovery path.
            </p>
            {this.state.message && <p className="text-xs text-amber-700 mt-2">{this.state.message}</p>}
            <button
              type="button"
              onClick={this.handleReload}
              className="mt-4 px-4 py-2 rounded-lg bg-primary text-white hover:bg-secondary text-sm font-medium"
            >
              Reload app
            </button>
          </SectionCard>
        </div>
      </div>
    );
  }
}

export { GlobalErrorBoundary as AppErrorBoundary };
export default GlobalErrorBoundary;
