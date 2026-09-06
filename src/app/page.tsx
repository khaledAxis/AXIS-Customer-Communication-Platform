import Link from "next/link";

import { countContentByState } from "../server/services/contentService";
import { countCampaignsByStatus, listNewsletters } from "../server/services/newsletterService";
import { requirePage } from "../server/auth/session";
import { Badge, Card, buttonPrimary } from "../ui/primitives";
import { Icon, type IconName } from "../ui/Icon";
import { CAMPAIGN_STATUS_LABEL, CAMPAIGN_STATUS_TONE, LANGUAGE_LABEL, formatDate } from "../ui/labels";

export const dynamic = "force-dynamic";

/** A read-only overview. Counts and recent work come from the existing services. */
export default async function DashboardPage() {
  await requirePage("/");
  const [contentCounts, campaignCounts, newsletters] = await Promise.all([
    countContentByState(),
    countCampaignsByStatus(),
    listNewsletters(),
  ]);
  const approved = contentCounts.APPROVED ?? 0;
  const needsReview = (contentCounts.PENDING_REVIEW ?? 0) + (contentCounts.NEW ?? 0);
  const drafts = campaignCounts.DRAFT ?? 0;
  const total = Object.values(campaignCounts).reduce((sum, n) => sum + n, 0);
  const stats: { label: string; value: number; hint: string; href: string; icon: IconName }[] = [
    { label: "Articles ready to use", value: approved, hint: "Approved content", href: "/content?filter=APPROVED", icon: "article" },
    { label: "Articles needing attention", value: needsReview, hint: "Drafts & pending review", href: "/content", icon: "inbox" },
    { label: "Newsletters in progress", value: drafts, hint: "Continue a draft", href: "/newsletters?status=DRAFT", icon: "mail" },
    { label: "Newsletters in total", value: total, hint: "Your communication library", href: "/newsletters", icon: "chart" },
  ];

  return (
    <>
      <div className="dashboard-heading"><span className="eyebrow">Your communication workspace</span><h1>Welcome to AXIS Communication</h1><p>A clear view of your content, your campaigns, and what comes next.</p></div>

      <section className="dashboard-hero" aria-labelledby="hero-title">
        <div className="hero-copy">
          <span className="eyebrow">Make every message matter</span>
          <h2 id="hero-title">Great communication.<br/>Precisely delivered.</h2>
          <p>Turn your expertise into newsletters that connect.<br/>Create, curate, and review — all in one place.</p>
          <div className="hero-actions"><Link href="/newsletters/new" className={buttonPrimary}><Icon name="plus" size={16}/>Create a newsletter</Link><Link href="/content/new">Write an article <Icon name="arrow" size={15}/></Link></div>
        </div>
        <div className="hero-map" aria-hidden="true">
          <svg viewBox="0 0 500 320" fill="none">
            {Array.from({ length: 11 }, (_, i) => <path key={i} d={`M${-100 + i * 23} -30C${40 + i * 19} 20 ${-20 + i * 26} 130 ${150 + i * 20} 150S${230 + i * 28} 290 ${440 + i * 16} 360`} stroke="#6b93ca" strokeOpacity={.18 + i * .025} strokeWidth="1"/>)}
            <path d="M125 240 212 155 333 112 421 56" stroke="#6795fa" strokeDasharray="4 5"/>
            <circle cx="212" cy="155" r="40" stroke="#6995f1" strokeOpacity=".15"/>
            <circle cx="212" cy="155" r="23" fill="#245bea" fillOpacity=".15" stroke="#6995f1" strokeOpacity=".35"/>
            <circle cx="212" cy="155" r="7" fill="#82acff" stroke="#dce9ff" strokeWidth="2"/>
            <circle cx="125" cy="240" r="4" fill="#719ce8"/>
            <circle cx="333" cy="112" r="4" fill="#719ce8"/>
            <circle cx="421" cy="56" r="4" fill="#719ce8"/>
            <path d="M392 240h20m-10-10v20 M78 78h14m-7-7v14" stroke="#758ba9" strokeOpacity=".5"/>
          </svg>
          <span className="map-label">A stronger connection.</span>
          <span className="map-caption">AXIS / CONNECTING EXPERTISE &amp; PEOPLE</span>
        </div>
      </section>

      <div className="stat-grid">{stats.map(stat => <Link href={stat.href} key={stat.label} className="axis-card stat-card"><div className="stat-top"><span>{stat.label}</span><Icon name={stat.icon} size={19}/></div><strong className="stat-value">{stat.value.toLocaleString("en-US")}</strong><div className="stat-bottom"><span>{stat.hint}</span><Icon name="arrow" size={13}/></div></Link>)}</div>

      <div className="dashboard-columns">
        <div>
          <Card className="overflow-hidden">
            <div className="panel-heading"><div><h2>Recent newsletters</h2><p>Pick up where you left off.</p></div><Link href="/newsletters" className="text-link">View all <Icon name="arrow" size={14}/></Link></div>
            {newsletters.length ? newsletters.slice(0, 5).map(newsletter => <Link href={`/newsletters/${newsletter.id}`} className="recent-row" key={newsletter.id}><span className="recent-icon"><Icon name="mail" size={19}/></span><div className="recent-copy"><strong dir="auto">{newsletter.name}</strong><small>{LANGUAGE_LABEL[newsletter.language]} · {newsletter._count.contentLinks} articles · {formatDate(newsletter.updatedAt)}</small></div><Badge tone={CAMPAIGN_STATUS_TONE[newsletter.status] ?? "neutral"}>{CAMPAIGN_STATUS_LABEL[newsletter.status] ?? newsletter.status}</Badge><Icon name="chevron" size={14} className="text-slate-400"/></Link>) : <div className="panel-empty"><p>Your next great newsletter starts here.</p><p className="mt-1 text-xs">Add approved articles, choose your audience, and preview every detail.</p><Link href="/newsletters/new" className="text-link mt-4">Create your first newsletter <Icon name="arrow" size={14}/></Link></div>}
          </Card>
          <Link href="/communication" className="quick-action"><Icon name="users" size={23}/><div><strong>Start with the right audience</strong><p>Review communication languages and consent, then build a focused audience for your next newsletter.</p><span className="text-link">Review communication profiles <Icon name="arrow" size={14}/></span></div></Link>
        </div>
        <Card>
          <div className="panel-heading"><div><h2>From an idea to a newsletter</h2><p>A little structure. A better message.</p></div><Icon name="target" size={20} className="text-slate-400"/></div>
          {[
            { title: "Create your content", body: "Write in Hebrew or Arabic. Add the details that matter.", href: "/content" },
            { title: "Review & curate", body: "Approve your articles, then choose the right mix.", href: "/content?filter=PENDING_REVIEW" },
            { title: "Build your newsletter", body: "Set the order, subject, and audience.", href: "/newsletters" },
            { title: "Preview & prepare", body: "Check the layout and readiness before any send.", href: "/newsletters" },
          ].map((step, i) => <Link href={step.href} key={step.title} className="workflow-step"><span>0{i + 1}</span><div><strong>{step.title}</strong><p>{step.body}</p></div></Link>)}
        </Card>
      </div>
    </>
  );
}
