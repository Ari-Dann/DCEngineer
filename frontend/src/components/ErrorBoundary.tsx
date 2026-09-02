import { Component, ReactNode } from "react";
import { useLocation } from "react-router-dom";

type InnerProps = {
  children: ReactNode;
  resetKey: string;
};

type InnerState = {
  error: Error | null;
};

class InnerBoundary extends Component<InnerProps, InnerState> {
  state: InnerState = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidUpdate(prev: InnerProps) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="page">
          <h1>This page failed to load</h1>
          <p className="error">{this.state.error.message}</p>
          <button className="btn primary" type="button" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function ErrorBoundary({ children }: { children: ReactNode }) {
  const location = useLocation();
  return <InnerBoundary resetKey={`${location.pathname}${location.search}`}>{children}</InnerBoundary>;
}
