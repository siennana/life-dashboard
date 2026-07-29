import { Component, type ReactNode } from "react";

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen bg-zinc-950 p-10 text-zinc-100">
          <h1 className="text-lg font-semibold text-red-400">Something went wrong</h1>
          <p className="mt-2 text-sm text-zinc-400">{this.state.error.message}</p>
        </div>
      );
    }
    return this.props.children;
  }
}
