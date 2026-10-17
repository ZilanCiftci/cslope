import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * Last line of defence for a render error (for example a damaged project
 * file): instead of a blank window, a message and a way to reload. The
 * project in memory is lost on reload; the file on disk is not touched.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("cSlope render error", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" style={{ padding: 32, fontFamily: "system-ui, sans-serif", maxWidth: 640 }}>
        <h1 style={{ fontSize: 18, marginBottom: 12 }}>cSlope ran into an error</h1>
        <p style={{ marginBottom: 12 }}>
          The window could not be drawn. This can happen with a damaged project file. Reload to start again; files on disk
          are not changed.
        </p>
        <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, opacity: 0.8, marginBottom: 16 }}>{this.state.error.message}</pre>
        <button type="button" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    );
  }
}
