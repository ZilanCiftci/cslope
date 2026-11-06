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
      <div role="alert" className="p-8 max-w-[640px] text-[12px]" style={{ color: "var(--color-vsc-text)" }}>
        <h1 className="text-[12px] font-semibold mb-2">cSlope ran into an error</h1>
        <p className="mb-3">
          The window could not be drawn. This can happen with a damaged project file. Reload to start again; files on disk
          are not changed.
        </p>
        <pre
          className="whitespace-pre-wrap text-[11px] mb-4 select-text"
          style={{ color: "var(--color-vsc-text-muted)" }}
        >
          {this.state.error.message}
        </pre>
        <button type="button" className="btn btn-primary min-w-[80px]" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    );
  }
}
