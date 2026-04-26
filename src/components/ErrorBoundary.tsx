import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Cursus crashed:", error, info.componentStack);
  }

  handleReload = () => {
    window.location.reload();
  };

  handleReset = () => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    const message = this.state.error.message || String(this.state.error);

    return (
      <div
        style={{ background: "var(--bg-base)", color: "var(--fg-primary)" }}
        className="h-full flex items-center justify-center p-8"
      >
        <div
          style={{
            background: "var(--bg-raised)",
            borderColor: "var(--border-strong)",
            boxShadow: "var(--shadow-md)",
          }}
          className="max-w-md w-full rounded-xl border p-6 fade-in"
        >
          <div
            style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
            className="h-10 w-10 rounded-full flex items-center justify-center mb-3"
          >
            <AlertTriangle size={18} />
          </div>
          <h2 className="text-[16px] font-semibold text-primary">
            Something went wrong
          </h2>
          <p className="text-[12.5px] text-muted mt-1 break-words">{message}</p>
          <p className="text-[12px] text-muted mt-3">
            The rest of the app is still running in the background. Reloading
            will rebuild the UI; your mailbox data on the server is untouched.
          </p>
          <div className="flex items-center gap-2 mt-4">
            <button
              type="button"
              onClick={this.handleReload}
              style={{ background: "var(--accent)", color: "#fff" }}
              className="h-8 px-3 rounded-md text-[12.5px] font-medium"
            >
              Reload window
            </button>
            <button
              type="button"
              onClick={this.handleReset}
              className="h-8 px-3 rounded-md text-[12.5px] font-medium text-secondary hover:text-primary hover:bg-hover"
            >
              Try again
            </button>
          </div>
        </div>
      </div>
    );
  }
}
