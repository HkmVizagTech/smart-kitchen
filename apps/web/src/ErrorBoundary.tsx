// Keeps one broken section from taking down the whole app.
//
// This matters more now than it did before the merge. When each role had its
// own app, a crash in the admin dashboard only broke the admin app. In one
// shared shell an unhandled render error blanks the entire page — nav, sign-out
// and all — for every role. The boundary sits around the section area only, so
// a failure shows a card and the rest of the app stays usable.

import { Component, ReactNode } from "react";

interface Props {
  /** Remounts the boundary when the section changes, clearing a stale error. */
  resetKey: string;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class SectionErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  componentDidCatch(error: Error) {
    console.error("[section crashed]", error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="card">
        <div className="section-title">This section didn’t load</div>
        <p className="muted" style={{ marginTop: 6 }}>
          Something went wrong displaying this page. The rest of the app still works — pick another
          section from the menu, or reload to try again.
        </p>
        <p className="muted" style={{ marginTop: 6, fontSize: 12 }}>{this.state.error.message}</p>
        <button className="btn sm" style={{ marginTop: 12 }} onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    );
  }
}
