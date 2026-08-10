import { Component } from "react";

/**
 * Catches render-time errors anywhere in the tree and renders a
 * recoverable fallback instead of a blank screen.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Wire to your observability tool of choice in production.
    console.error("ErrorBoundary caught", error, info);
  }

  handleReset = () => {
    this.setState({ error: null });
  };

  handleReload = () => {
    window.location.reload();
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div role="alert" className="error-fallback">
        <h2>Something went wrong.</h2>
        <p className="error-fallback-message">{error.message || "Unknown error"}</p>
        <div className="error-fallback-actions">
          <button type="button" onClick={this.handleReset}>
            Try again
          </button>
          <button type="button" onClick={this.handleReload}>
            Reload page
          </button>
        </div>
      </div>
    );
  }
}
