import React from 'react';
import SectionCard from './SectionCard';

interface Props {
  pageLabel?: string;
  onRecover?: () => void;
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  message: string | null;
}

class AppErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, message: null };

  static getDerivedStateFromError(error: unknown): State {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : 'Unexpected UI error.',
    };
  }

  componentDidUpdate(prevProps: Props) {
    if (prevProps.pageLabel !== this.props.pageLabel && this.state.hasError) {
      this.setState({ hasError: false, message: null });
    }
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <SectionCard title="We recovered from a page error" className="border-amber-200 bg-amber-50/60">
        <p className="text-sm text-amber-900">
          The <strong>{this.props.pageLabel ?? 'current'}</strong> page encountered an issue. We prevented a full system white-screen.
        </p>
        {this.state.message && <p className="text-xs text-amber-700 mt-2">{this.state.message}</p>}
        <button
          type="button"
          onClick={this.props.onRecover}
          className="mt-4 px-4 py-2 rounded-lg bg-primary text-white hover:bg-secondary text-sm font-medium"
        >
          Return to Dashboard
        </button>
      </SectionCard>
    );
  }
}

export default AppErrorBoundary;
