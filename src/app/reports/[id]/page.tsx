import Link from 'next/link';
import { ReportView } from '@/components/report-view.tsx';
import { getReportStore } from '@/lib/reports/store.ts';
import { isPrefixedId } from '@/lib/utils/id.ts';
import { SiteHeader } from '@/components/site-header.tsx';

export const dynamic = 'force-dynamic';

export default async function ReportDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isPrefixedId(id, 'rpt')) return <main className="shell"><section className="content"><h1>Invalid report id</h1><Link href="/reports">Back to reports</Link></section></main>;
  const report = getReportStore().get(id);
  if (!report) return <main className="shell"><section className="content"><h1>Report not found</h1><p>This report may have been removed or the local database may be unavailable.</p><Link href="/reports">Back to reports</Link></section></main>;
  return <main className="shell"><SiteHeader activeSection="reports" /><section className="content"><p className="eyebrow"><Link href="/reports">REPORT HISTORY</Link> / {report.request.symbol}</p><h1>{report.request.symbol} research report</h1><ReportView initialReport={report}/></section></main>;
}
