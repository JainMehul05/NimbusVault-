import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  CircleCheck,
  Clock,
  Cloud,
  Code2,
  Database,
  Download,
  FileArchive,
  FileText,
  Folder,
  FolderOpen,
  GitBranch,
  KeyRound,
  Link2,
  LockKeyhole,
  Menu,
  Network,
  Plus,
  Search,
  Server,
  ShieldCheck,
  Sparkles,
  UploadCloud,
  Users,
  X,
} from 'lucide-react'
import { cn } from '@lib/utils'

// Every feature listed here is implemented (Phases 1–4). AI features require a server-side provider.
const features = [
  { icon: LockKeyhole, eyebrow: 'Accounts', title: 'Secure sign-in', body: 'Sessions you can review and end per device, rotating tokens your browser scripts can never read, and permission checks on every request.', accent: 'cyan' },
  { icon: UploadCloud, eyebrow: 'Storage', title: 'Upload and download', body: 'Drag files in, track progress per file, and download anytime. Up to 25 MB per file with a clear storage meter.', accent: 'blue' },
  { icon: FolderOpen, eyebrow: 'Organization', title: 'Folders that nest', body: 'Create, rename, and move folders. Breadcrumbs, a folder tree, search, sorting, and a trash you can restore from.', accent: 'violet' },
  { icon: Users, eyebrow: 'Collaboration', title: 'Share with people', body: 'Invite registered users to files or whole folders as Viewers or Editors, and change or remove access anytime.', accent: 'blue' },
  { icon: Link2, eyebrow: 'Share links', title: 'Links you control', body: 'Create view-only or download links with expiry dates, optional passwords, and download limits. Revoke in one click.', accent: 'cyan' },
  { icon: Activity, eyebrow: 'Audit trail', title: 'Activity history', body: 'See uploads, downloads, renames, moves, deletions, sign-ins, and sharing changes in one chronological, filterable timeline.', accent: 'violet' },
  { icon: Sparkles, eyebrow: 'Document AI', title: 'Search and ask your documents', body: 'PDF, Word, Markdown, and text files are indexed for local meaning-based search and Qwen answers that cite their sources — only across documents you can access. MiniLM embeddings and Qwen generation run on your laptop; original files use private AWS S3.', accent: 'blue' },
]

const docs = [
  { icon: FileText, name: 'Product architecture.pdf', meta: '2.4 MB · Today', color: 'text-cyan-300' },
  { icon: FileArchive, name: 'Brand system assets.zip', meta: '18.7 MB · Yesterday', color: 'text-violet-300' },
  { icon: FileText, name: 'Q3 planning notes.docx', meta: '840 KB · Sep 18', color: 'text-blue-300' },
]

function Logo() {
  return (
    <div className="flex items-center gap-3">
      <div className="logo-mark">
        <span className="logo-nv">N</span>
        <i />
      </div>
      <span className="text-[15px] font-semibold tracking-[-0.03em] text-white">
        NIMBUS<span className="text-[#ff5100]">VAULT</span>
      </span>
    </div>
  )
}

function VaultVisual() {
  return (
    <div className="vault-stage" role="img" aria-label="Illustration of the NimbusVault secure storage core">
      <div className="orbit orbit-one" />
      <div className="orbit orbit-two" />
      <div className="orbit orbit-three" />
      <span className="node node-one" />
      <span className="node node-two" />
      <span className="node node-three" />
      <div className="vault-glow" />
      <div className="vault-core legacy-core">
        <div className="core-face core-face-back" />
        <div className="core-face core-face-left" />
        <div className="core-face core-face-right" />
        <div className="core-grid" />
        <div className="core-scanline" />
        <div className="vault-inner">
          <LockKeyhole size={34} strokeWidth={1.4} />
          <span>NV</span>
        </div>
        <div className="core-label">SECURE / 01</div>
        <div className="core-corner corner-a" />
        <div className="core-corner corner-b" />
      </div>
      <div className="data-tag tag-one"><span className="pulse-dot" /> Owner · Editor · Viewer</div>
      <div className="data-tag tag-two"><Clock size={12} /> Links that expire</div>
    </div>
  )
}

/** Illustrative product preview built from real product concepts (sample data). */
function ProductPreview() {
  const [activeDoc, setActiveDoc] = useState(0)
  const [query, setQuery] = useState('')
  const filteredDocs = docs.filter((doc) => doc.name.toLowerCase().includes(query.toLowerCase()))

  return (
    <div className="preview-shell" id="showcase" aria-label="Product preview with sample data">
      <div className="preview-topbar">
        <div className="flex items-center gap-2" aria-hidden="true">
          <div className="window-dot bg-[#fb7185]" />
          <div className="window-dot bg-[#facc15]" />
          <div className="window-dot bg-[#4ade80]" />
        </div>
        <div className="preview-path"><Folder size={12} /> My Files / Product</div>
        <div className="preview-avatar" aria-hidden="true">MC</div>
      </div>
      <div className="preview-body">
        <aside className="preview-sidebar">
          <div className="flex items-center gap-2 text-xs font-medium text-white">
            <div className="mini-mark"><Cloud size={12} /></div> NimbusVault
          </div>
          <button
            type="button"
            className="new-button"
            onClick={() => { window.location.assign('/files') }}
          >
            <UploadCloud size={13} /> Open your files
          </button>
          <div className="sidebar-label">Workspace</div>
          <div className="sidebar-item active"><FolderOpen size={14} /> My Files <span>24</span></div>
          <div className="sidebar-item"><Users size={14} /> Shared with me</div>
          <div className="sidebar-item"><Activity size={14} /> Activity</div>
          <div className="sidebar-label mt-5">Folders</div>
          <div className="sidebar-item"><Folder size={14} /> Product</div>
          <div className="sidebar-item"><Folder size={14} /> Marketing</div>
          <div className="sidebar-item"><Folder size={14} /> Legal</div>
          <div className="storage-card">
            <div className="flex items-center justify-between text-[10px] text-slate-400">
              <span>Storage</span><span>42%</span>
            </div>
            <div className="storage-bar"><span /></div>
            <p>2.1 GB of 5 GB used</p>
          </div>
        </aside>
        <div className="preview-main">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="preview-kicker">MY FILES / PRODUCT</p>
              <h3 className="text-[21px] font-medium tracking-[-0.04em] text-white">Product</h3>
            </div>
            <span className="preview-icon-btn" aria-hidden="true"><Search size={15} /></span>
          </div>
          <label className="preview-search">
            <Search size={14} />
            <input
              aria-label="Try searching the sample files"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search files and folders..."
            />
          </label>
          <div className="file-table">
            <div className="file-table-head">
              <span>Name</span><span>Uploaded</span><span>Size</span>
            </div>
            {filteredDocs.map((doc) => {
              const i = docs.indexOf(doc)
              return (
                <button type="button" className={cn('file-row', activeDoc === i && 'selected')} key={doc.name} onClick={() => setActiveDoc(i)} aria-pressed={activeDoc === i}>
                  <div className="flex min-w-0 items-center gap-3">
                    <doc.icon className={doc.color} size={17} />
                    <span className="truncate text-xs text-slate-200">{doc.name}</span>
                  </div>
                  <span className="text-[10px] text-slate-500">{doc.meta.split(' · ')[1]}</span>
                  <span className="text-[10px] text-slate-500">{doc.meta.split(' · ')[0]}</span>
                </button>
              )
            })}
            {filteredDocs.length === 0 && <p className="px-3 py-4 text-[11px] text-slate-500">No sample files match “{query}”.</p>}
          </div>
          <div className="preview-status"><CircleCheck size={14} /> Upload complete <span>·</span> just now</div>
        </div>
        <aside className="share-panel" aria-label="Sharing preview">
          <div className="share-panel-head">
            <div className="share-mark"><Users size={13} /></div>
            <div>
              <p>Share “{docs[activeDoc].name}”</p>
              <p>People with access</p>
            </div>
          </div>
          <div className="share-person"><span className="avatar">MC</span><span>Maya Chen (you)</span><span className="role-chip owner">Owner</span></div>
          <div className="share-person"><span className="avatar b">AR</span><span>Arjun Rao</span><span className="role-chip editor">Editor</span></div>
          <div className="share-person"><span className="avatar c">SK</span><span>Sofia Kim</span><span className="role-chip">Viewer</span></div>
          <div className="share-label">Share link</div>
          <div className="share-link-row"><Link2 size={12} /><code>nimbusvault.app/share/••••••</code></div>
          <div className="share-link-meta">
            <span><Clock size={10} /> Expires in 7 days</span>
            <span><KeyRound size={10} /> Password</span>
            <span><Download size={10} /> 3/10 downloads</span>
          </div>
        </aside>
      </div>
    </div>
  )
}

function ArrowUpRightIcon() { return <ArrowRight className="-rotate-45" size={12} /> }

const securityItems: Array<[string, string]> = [
  ['Short-lived access tokens', 'Sessions use 15-minute JWT access tokens, so a leaked token stops working quickly.'],
  ['Refresh-token rotation with reuse detection', 'Each refresh issues a new token. Reusing an old one revokes the whole session family.'],
  ['Role-based access on every request', 'Owner, Editor, and Viewer permissions are checked server-side for every file and folder action.'],
  ['Hardened share links', 'Link tokens and passwords are stored hashed, links can expire or cap downloads, and public access is rate limited.'],
  ['Security headers and validated input', 'Strict HTTP security headers, CORS rules, and schema validation at every API boundary.'],
]

const faqs: Array<[string, string]> = [
  ['Who can see my files?', 'Only you, unless you share. You choose each person’s role. Viewers can view and download. Editors can also upload, rename, move, and share. You can change or remove access at any time.'],
  ['Can I share with someone who doesn’t have an account?', 'Yes, with a share link. Choose view-only or download access, set an expiry date, add a password, and cap the number of downloads. Revoke the link whenever you like.'],
  ['How much can I store?', 'Each account includes 5 GB of storage, and individual files can be up to 25 MB. Your storage meter always shows what’s used and what’s left.'],
  ['Can I see what happened to a file?', 'Yes. The Activity page records downloads, renames, moves, deletions, and sharing changes, with filters for event, item type, and date.'],
]

export default function LandingPage() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const [lightMode, setLightMode] = useState(false)
  const [openFaq, setOpenFaq] = useState<number | null>(0)
  const [activeSecurity, setActiveSecurity] = useState<number | null>(null)
  const pageRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const revealItems = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]'))
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible')
          observer.unobserve(entry.target)
        }
      })
    }, { threshold: 0.14 })
    revealItems.forEach((item) => observer.observe(item))
    return () => observer.disconnect()
  }, [])

  function handlePointerMove(event: React.PointerEvent<HTMLElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    const x = ((event.clientX - rect.left) / rect.width - 0.5) * 2
    const y = ((event.clientY - rect.top) / rect.height - 0.5) * 2
    pageRef.current?.style.setProperty('--pointer-x', `${x.toFixed(3)}`)
    pageRef.current?.style.setProperty('--pointer-y', `${y.toFixed(3)}`)
  }

  const navItems = [
    ['#features', 'Features'],
    ['#collaboration', 'Collaboration'],
    ['#security', 'Security'],
    ['#faq', 'FAQ'],
  ]

  return (
    <main ref={pageRef} onPointerMove={handlePointerMove} className={`min-h-screen overflow-hidden text-slate-200 ${lightMode ? 'light-mode' : ''}`}>
      <div className="site-noise" />
      <nav className="site-nav" aria-label="Main">
        <div className="container-custom nav-inner">
          <Link to="/" className="brand-link" aria-label="NimbusVault home"><Logo /></Link>
          <div className="nav-primary hidden items-center gap-8 md:flex">
            {navItems.map(([href, label], i) => (
              <a key={href} href={href} className="nav-link"><span>0{i + 1}</span>{label}</a>
            ))}
          </div>
          <div className="nav-actions hidden items-center gap-4 md:flex">
            <button type="button" className="theme-toggle" onClick={() => setLightMode(!lightMode)} aria-label={lightMode ? 'Switch to dark theme' : 'Switch to light theme'} aria-pressed={lightMode}>
              <span className="theme-toggle-orb" aria-hidden="true">{lightMode ? '☼' : '◐'}</span>
              <span>{lightMode ? 'Light' : 'Dark'}</span>
            </button>
            <Link to="/login" className="nav-login">Sign in <ArrowUpRight size={12} /></Link>
            <Link to="/register" className="button button-small nav-cta">Get started <ArrowRight size={14} /></Link>
          </div>
          <button type="button" className="mobile-menu md:hidden" onClick={() => setMobileOpen(!mobileOpen)} aria-label={mobileOpen ? 'Close menu' : 'Open menu'} aria-expanded={mobileOpen} aria-controls="mobile-nav">
            {mobileOpen ? <X /> : <Menu />}
          </button>
        </div>
        {mobileOpen && (
          <div className="mobile-nav md:hidden" id="mobile-nav">
            {navItems.map(([href, label]) => <a key={href} href={href} onClick={() => setMobileOpen(false)}>{label}</a>)}
            <Link to="/login">Sign in</Link>
            <Link to="/register" className="button button-small justify-center">Get started <ArrowRight size={14} /></Link>
          </div>
        )}
      </nav>

      <section id="top" className="hero-section">
        <div className="hero-grid" />
        <div className="container-custom relative grid items-center gap-14 pb-20 pt-20 lg:grid-cols-[0.88fr_1.12fr] lg:gap-8 lg:pb-28 lg:pt-28">
          <div className="hero-copy">
            <div className="eyebrow"><span className="eyebrow-dot" /> AWS storage · local intelligence</div>
            <h1>Your files. Your rules. <span>Secured.</span></h1>
            <p className="hero-lede">NimbusVault keeps your files organized in folders, lets you share them with exactly the right people, and records what happens to them.</p>
            <div className="flex flex-wrap items-center gap-4">
              <Link to="/register" className="button">Create your free vault <ArrowRight size={16} /></Link>
              <a href="#features" className="text-link">See what’s included <ChevronDown size={15} /></a>
            </div>
            <div className="hero-proof">
              <div className="proof-avatars" aria-hidden="true"><span>5GB</span><span>3</span><span>∞</span></div>
              <p><strong>5 GB storage,</strong> 3 access roles, and unlimited share links.</p>
            </div>
          </div>
          <div className="hero-art"><VaultVisual /></div>
        </div>
        <div className="container-custom"><p className="mb-3 text-xs text-slate-400">Illustrative product preview · sample data</p><ProductPreview /></div>
      </section>

      <section className="stack-strip" aria-label="Technology">
        <div className="container-custom">
          <div className="strip-label">Built with</div>
          <div className="stack-items">
            <span><Code2 size={16} /> React</span>
            <span><Code2 size={16} /> TypeScript</span>
            <span><Server size={16} /> Express</span>
            <span><Database size={16} /> PostgreSQL</span>
            <span><Network size={16} /> Prisma</span>
            <span><Cloud size={16} /> Docker</span>
          </div>
        </div>
      </section>

      <section className="section-pad reveal-section" data-reveal id="features">
        <div className="container-custom">
          <div className="section-heading">
            <div>
              <p className="section-kicker">Everything you need</p>
              <h2>Storage that stays <em>organized.</em></h2>
            </div>
            <p className="section-intro">The essentials for storing, organizing, and sharing files, with security built into every layer.</p>
          </div>
          <div className="feature-grid">
            {features.map((feature) => (
              <article className={cn('feature-card', feature.accent)} key={feature.title}>
                <div className="feature-icon"><feature.icon size={19} /></div>
                <div className="feature-label">{feature.eyebrow}</div>
                <h3>{feature.title}</h3>
                <p>{feature.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section-pad workflow-section reveal-section" data-reveal id="how-it-works">
        <div className="container-custom">
          <div className="section-heading centered">
            <div>
              <p className="section-kicker">Simple by design</p>
              <h2>From scattered to <em>shared.</em></h2>
            </div>
            <p className="section-intro">A workflow that stays out of the way.</p>
          </div>
          <div className="steps">
            <div className="step"><span>01</span><div className="step-icon"><UploadCloud size={21} /></div><h3>Upload and organize</h3><p>Drop files in and arrange them in nested folders. Search, sort, and filter to find anything fast.</p></div>
            <div className="step-line" />
            <div className="step"><span>02</span><div className="step-icon"><Users size={21} /></div><h3>Share with intent</h3><p>Invite people as Viewers or Editors, or send a link with an expiry date, password, and download limit.</p></div>
            <div className="step-line" />
            <div className="step"><span>03</span><div className="step-icon"><Activity size={21} /></div><h3>Stay in the loop</h3><p>Review the activity timeline to see downloads, changes, and who has access.</p></div>
          </div>
        </div>
      </section>

      <section className="collab-section section-pad reveal-section" data-reveal id="collaboration">
        <div className="container-custom">
          <div className="section-heading">
            <div>
              <p className="section-kicker">Collaboration</p>
              <h2>The right access for <em>every person.</em></h2>
            </div>
            <p className="section-intro">Share a single file or an entire folder. Access inherits to everything inside a shared folder.</p>
          </div>
          <div className="role-grid">
            {([
              { role: 'owner', tag: 'Owner', title: 'Full control', can: ['View and download', 'Rename, move, and delete', 'Share and manage access', 'Create and revoke share links'], cannot: [] },
              { role: 'editor', tag: 'Editor', title: 'Work alongside you', can: ['View and download', 'Upload, rename, and move', 'Share with others', 'Create share links'], cannot: ['Delete or manage access'] },
              { role: 'viewer', tag: 'Viewer', title: 'Read-only access', can: ['View and download'], cannot: ['Rename, move, or delete', 'Share with others'] },
            ]).map((r) => (
              <article key={r.role} className={cn('role-card', r.role)}>
                <span className="role-tag">{r.tag}</span>
                <h3>{r.title}</h3>
                <ul>
                  {r.can.map((c) => <li key={c}><Check size={14} aria-hidden="true" /> {c}</li>)}
                  {r.cannot.map((c) => <li key={c} className="off"><X size={14} aria-hidden="true" /> <span><span className="sr-only">Cannot: </span>{c}</span></li>)}
                </ul>
              </article>
            ))}
          </div>
          <div className="link-controls" aria-label="Share link controls">
            <div><Link2 size={18} aria-hidden="true" /><h4>View or download</h4><p>Decide whether recipients can download, or only see the file details.</p></div>
            <div><Clock size={18} aria-hidden="true" /><h4>Expiry dates</h4><p>Links stop working after 1, 7, or 30 days, or at a time you choose.</p></div>
            <div><KeyRound size={18} aria-hidden="true" /><h4>Passwords</h4><p>Require a password before anyone can open the link.</p></div>
            <div><Download size={18} aria-hidden="true" /><h4>Download limits</h4><p>Cap downloads, track usage, and revoke a link in one click.</p></div>
          </div>
        </div>
      </section>

      <section className="security-section reveal-section" data-reveal id="security">
        <div className="container-custom grid items-center gap-14 lg:grid-cols-[0.92fr_1.08fr]">
          <div>
            <p className="section-kicker">Trust is a feature</p>
            <h2>Security that’s <em>built in.</em></h2>
            <p className="body-copy">NimbusVault applies security fundamentals from the first request to the last download.</p>
            <Link to="/register" className="text-link">Start with a secure vault <ArrowRight size={15} /></Link>
          </div>
          <div className="security-list">
            <div className="security-list-glow" />
            {securityItems.map(([item, detail], index) => (
              <button
                type="button"
                className={cn('security-item', activeSecurity === index ? 'expanded' : '')}
                key={item}
                onClick={() => setActiveSecurity(activeSecurity === index ? null : index)}
                aria-expanded={activeSecurity === index}
              >
                <div className="check-icon"><Check size={14} /></div>
                <span>{item}</span>
                <Plus size={14} className="security-plus" aria-hidden="true" />
                {activeSecurity === index && <small>{detail}</small>}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="trust-section reveal-section" data-reveal>
        <div className="container-custom">
          <div className="trust-intro">
            <p className="section-kicker">Clear limits, no surprises</p>
            <h2>Straightforward by <em>default.</em></h2>
            <p>Know exactly what your account includes, and see your usage at a glance.</p>
          </div>
          <div className="trust-stats">
            <div><strong>5 GB</strong><span>storage per account</span></div>
            <div><strong>25 MB</strong><span>max size per file</span></div>
            <div><strong>3</strong><span>access roles</span></div>
          </div>
        </div>
      </section>

      <section className="faq-section section-pad reveal-section" data-reveal id="faq">
        <div className="container-custom">
          <div className="section-heading">
            <div>
              <p className="section-kicker">Good to know</p>
              <h2>Questions before you <em>begin.</em></h2>
            </div>
            <p className="section-intro">The useful details, in plain language.</p>
          </div>
          <div className="faq-list">
            {faqs.map(([question, answer], index) => (
              <div className={cn('faq-item', openFaq === index ? 'open' : '')} key={question}>
                <button type="button" onClick={() => setOpenFaq(openFaq === index ? null : index)} aria-expanded={openFaq === index} aria-controls={`faq-${index}`}>
                  <span>{question}</span>
                  <Plus size={17} aria-hidden="true" />
                </button>
                {openFaq === index && <p id={`faq-${index}`}>{answer}</p>}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="final-cta">
        <div className="container-custom">
          <div className="cta-card">
            <div className="cta-glow" />
            <div className="cta-orbit" />
            <p className="section-kicker">The vault is open</p>
            <h2>Give your files a <em>secure home.</em></h2>
            <p>Create an account in under a minute. Upload, organize, and share on your terms.</p>
            <div className="flex flex-wrap justify-center gap-4">
              <Link to="/register" className="button">Create your free vault <ArrowRight size={16} /></Link>
              <Link to="/login" className="button button-ghost">Sign in <ShieldCheck size={15} /></Link>
            </div>
          </div>
        </div>
      </section>

      <footer className="site-footer">
        <div className="container-custom flex flex-col gap-8 py-10 md:flex-row md:items-center md:justify-between">
          <div>
            <Logo />
            <p className="mt-3 text-xs text-slate-400">Secure cloud storage and sharing.</p>
          </div>
          <nav className="footer-links" aria-label="Footer">
            <a href="#features">Features</a>
            <a href="#collaboration">Collaboration</a>
            <a href="#security">Security</a>
            <Link to="/login">Sign in</Link>
            <Link to="/register">Create account</Link>
            <a href="https://github.com/JainMehul05/NimbusVault-" target="_blank" rel="noreferrer">GitHub <ArrowUpRightIcon /><span className="sr-only"> (opens in a new tab)</span></a>
          </nav>
          <p className="text-xs text-slate-400">© 2026 NimbusVault <GitBranch size={11} className="ml-1 inline" aria-hidden="true" /></p>
        </div>
      </footer>
    </main>
  )
}
