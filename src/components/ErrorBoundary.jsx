import { Component } from "react";
import { C, F } from "../lib/tokens";

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          flexDirection: "column", gap: 20, height: "100%", minHeight: 300,
          background: C.linen, padding: 40,
        }}>
          <div style={{
            fontFamily: F.display, fontSize: 28, fontWeight: 800,
            color: C.textHead, letterSpacing: "0.04em", textTransform: "uppercase",
          }}>
            Something went wrong
          </div>
          <div style={{
            fontFamily: F.ui, fontSize: 14, color: C.textHead, maxWidth: 480,
            textAlign: "center", lineHeight: 1.5,
          }}>
            An unexpected error occurred. Try reloading the page.
          </div>
          <button
            onClick={() => window.location.reload()}
            style={{
              fontFamily: F.display, fontSize: 13, fontWeight: 700,
              letterSpacing: "0.06em", textTransform: "uppercase",
              background: C.dark, color: C.teal, border: "none",
              borderRadius: 7, padding: "10px 28px", cursor: "pointer",
            }}
          >
            Reload
          </button>
          {this.state.error && (
            <div style={{
              fontFamily: F.ui, fontSize: 11, color: C.textFaint,
              maxWidth: 560, textAlign: "center", wordBreak: "break-word",
              marginTop: 8,
            }}>
              {this.state.error.message}
            </div>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}
