import Link from 'next/link';

export default function ReportsPage() {
  return <main className="shell"><header className="topbar"><Link className="brand" href="/"><span className="brand-mark">C</span><span>CATALYST <small>RESEARCH DESK</small></span></Link><nav><Link href="/">Workspace</Link><a className="active" href="/reports">Reports</a><Link href="/settings">Settings</Link></nav><span className="research-only">RESEARCH ONLY</span></header><section className="content"><p className="eyebrow">LIBRARY</p><h1>Research reports</h1><div className="welcome"><h2>No saved reports yet</h2><p>Generated reports will appear here after report generation and local storage are connected.</p><Link href="/">Return to workspace</Link></div></section></main>;
}
