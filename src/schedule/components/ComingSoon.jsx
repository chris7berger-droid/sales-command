// Shared honest placeholder for calendar-pane slots whose data source isn't wired
// this build (health badge, Production %, Files, job photo, Recent Activity — plan
// §8.3 L). Never render a fabricated or zero value that reads as real; render this.

export default function ComingSoon({ label = 'Coming soon', inline = false }) {
  const style = {
    fontFamily: 'var(--font-body)',
    fontSize: inline ? 11 : 12,
    fontStyle: 'italic',
    color: 'var(--text-light)',
    background: inline ? 'transparent' : 'var(--bg-muted, rgba(0,0,0,0.03))',
    border: inline ? 'none' : '1px dashed var(--border)',
    borderRadius: 4,
    padding: inline ? 0 : '10px 12px',
    textAlign: inline ? 'left' : 'center',
  }
  return <div className="cal-coming-soon" style={style}>{label}</div>
}
