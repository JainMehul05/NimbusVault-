import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight,
  ArrowUpRight,
  Bot,
  Check,
  ChevronDown,
  CircleCheck,
  Cloud,
  Code2,
  Database,
  FileArchive,
  FileText,
  Folder,
  FolderOpen,
  GitBranch,
  LockKeyhole,
  Menu,
  Network,
  Search,
  Send,
  Server,
  ShieldCheck,
  Sparkles,
  UploadCloud,
  X,
  Zap,
  Plus,
} from 'lucide-react'
import { cn } from '@lib/utils'

const features = [
  { icon: LockKeyhole, eyebrow: 'Available now', title: 'Secure by default', body: 'JWT authentication, short-lived access tokens and protected routes keep every workspace boundary intentional.', accent: 'cyan' },
  { icon: FolderOpen, eyebrow: 'Available now', title: 'A calmer file system', body: 'Organize files into folders with clear metadata, fast browsing and a foundation built to scale.', accent: 'blue' },
  { icon: GitBranch, eyebrow: 'Next up', title: 'Version history', body: 'Keep context intact as documents change. Restore, compare and collaborate without losing the thread.', accent: 'violet' },
  { icon: Network, eyebrow: 'Next up', title: 'Controlled sharing', body: 'Share the right file with the right person, with access controls designed for teams.', accent: 'blue' },
  { icon: Search, eyebrow: 'Roadmap', title: 'Semantic search', body: 'Find meaning across your content, not just filenames, with embeddings and vector retrieval.', accent: 'cyan' },
  { icon: Bot, eyebrow: 'Roadmap', title: 'Grounded answers', body: 'Ask questions of your documents and get answers connected to the source material.', accent: 'violet' },
]

const docs = [
  { icon: FileText, name: 'Product architecture.pdf', meta: '2.4 MB · Edited today', color: 'text-cyan-300' },
  { icon: FileArchive, name: 'Brand system assets.zip', meta: '18.7 MB · Edited yesterday', color: 'text-violet-300' },
  { icon: FileText, name: 'Q3 planning notes.docx', meta: '840 KB · Edited Sep 18', color: 'text-blue-300' },
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
    <div className="vault-stage" aria-label="Illustration of a glowing NimbusVault data core">
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
      <div className="data-tag tag-one"><span className="pulse-dot" /> 12.8 GB indexed</div>
      <div className="data-tag tag-two"><Sparkles size={12} /> AI layer ready</div>
    </div>
  )
}

function ProductPreview() {
  const [activeDoc, setActiveDoc] = useState(0)
  const [query, setQuery] = useState('')
  const [aiQuery, setAiQuery] = useState('')
  const [uploading, setUploading] = useState(false)
  const filteredDocs = docs.filter((doc) => doc.name.toLowerCase().includes(query.toLowerCase()))

  return (
    <div className="preview-shell" id="showcase">
      <div className="preview-topbar">
        <div className="flex items-center gap-2">
          <div className="window-dot bg-[#fb7185]" />
          <div className="window-dot bg-[#facc15]" />
          <div className="window-dot bg-[#4ade80]" />
        </div>
        <div className="preview-path"><Folder size={12} /> Workspace / Product</div>
        <div className="preview-avatar">MC</div>
      </div>
      <div className="preview-body">
        <aside className="preview-sidebar">
          <div className="flex items-center gap-2 text-xs font-medium text-white">
            <div className="mini-mark"><Cloud size={12} /></div> NimbusVault
          </div>
          <button
            className={cn('new-button', uploading && 'uploading')}
            onClick={() => { setUploading(true); window.setTimeout(() => setUploading(false), 1400) }}
          >
            <UploadCloud size={13} /> {uploading ? 'Indexing file...' : 'Upload file'}
          </button>
          <div className="sidebar-label">Workspace</div>
          <div className="sidebar-item active"><FolderOpen size={14} /> All files <span>24</span></div>
          <div className="sidebar-item"><Sparkles size={14} /> Starred</div>
          <div className="sidebar-item"><Network size={14} /> Shared with me</div>
          <div className="sidebar-label mt-5">Folders</div>
          <div className="sidebar-item"><Folder size={14} /> Product</div>
          <div className="sidebar-item"><Folder size={14} /> Marketing</div>
          <div className="sidebar-item"><Folder size={14} /> Legal</div>
          <div className="storage-card">
            <div className="flex items-center justify-between text-[10px] text-slate-400">
              <span>Storage</span><span>42%</span>
            </div>
            <div className="storage-bar"><span /></div>
            <p>4.2 GB of 10 GB used</p>
          </div>
        </aside>
        <div className="preview-main">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="preview-kicker">PRODUCT WORKSPACE</p>
              <h3 className="text-[21px] font-medium tracking-[-0.04em] text-white">All files</h3>
            </div>
            <button className="preview-icon-btn" aria-label="Search files"><Search size={15} /></button>
          </div>
          <label className="preview-search">
            <Search size={14} />
            <input
              aria-label="Search files and folders"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search files and folders..."
            />
            <kbd>⌘ K</kbd>
          </label>
          <div className="file-table">
            <div className="file-table-head">
              <span>Name</span><span>Last modified</span><span>Size</span>
            </div>
            {filteredDocs.map((doc) => {
              const i = docs.indexOf(doc)
              return (
                <button
                  className={cn('file-row', activeDoc === i && 'selected')}
                  key={doc.name}
                  onClick={() => setActiveDoc(i)}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <doc.icon className={doc.color} size={17} />
                    <span className="truncate text-xs text-slate-200">{doc.name}</span>
                  </div>
                  <span className="text-[10px] text-slate-500">{doc.meta.split(' · ')[1]}</span>
                  <span className="text-[10px] text-slate-500">{doc.meta.split(' · ')[0]}</span>
                </button>
              )
            })}
          </div>
          <div className="preview-status"><CircleCheck size={14} /> All files synced <span>·</span> Updated just now</div>
        </div>
        <aside className="ai-panel">
          <div className="ai-panel-head">
            <div className="ai-spark"><Sparkles size={13} /></div>
            <div>
              <p className="text-xs font-medium text-white">Nimbus AI</p>
              <p className="text-[10px] text-slate-500">Document intelligence</p>
            </div>
            <span className="ai-live">BETA</span>
          </div>
          <div className="ai-question">What&apos;s in my product architecture?</div>
          <div className="ai-answer">
            <div className="flex items-center gap-2 text-[10px] font-medium text-cyan-200"><Bot size={13} /> Grounded answer</div>
            <p>It outlines the core services, data flow and security boundaries for the NimbusVault platform.</p>
            <div className="source-chip"><FileText size={11} /> Product architecture.pdf <span>↗</span></div>
          </div>
          <form className="ai-input" onSubmit={(event) => { event.preventDefault(); setAiQuery('Grounded answer ready — source context found.'); }}>
            <input
              aria-label="Ask Nimbus AI"
              value={aiQuery}
              onChange={(event) => setAiQuery(event.target.value)}
              placeholder="Ask about your files..."
            />
            <button type="submit" aria-label="Send AI question"><Send size={13} /></button>
          </form>
        </aside>
      </div>
    </div>
  )
}

function ArrowUpRightIcon() { return <ArrowRight className="-rotate-45" size={12} /> }

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

  return (
    <main ref={pageRef} onPointerMove={handlePointerMove} className={`min-h-screen overflow-hidden text-slate-200 ${lightMode ? 'light-mode' : ''}`}>
      <div className="site-noise" />
      <nav className="site-nav">
        <div className="container-custom nav-inner">
          <Link to="/" className="brand-link" aria-label="NimbusVault home"><Logo /></Link>
          <div className="nav-primary hidden items-center gap-8 md:flex">
            <a href="#features" className="nav-link"><span>01</span>Features</a>
            <a href="#security" className="nav-link"><span>02</span>Security</a>
            <a href="#how-it-works" className="nav-link"><span>03</span>How it works</a>
            <a href="#roadmap" className="nav-link"><span>04</span>Roadmap</a>
          </div>
          <div className="nav-actions hidden items-center gap-4 md:flex">
            <button className="theme-toggle" onClick={() => setLightMode(!lightMode)} aria-label={lightMode ? 'Switch to dark theme' : 'Switch to light theme'}>
              <span className="theme-toggle-orb">{lightMode ? '☼' : '◐'}</span>
              <span>{lightMode ? 'Light' : 'Dark'}</span>
            </button>
            <Link to="/login" className="nav-login">Log in <ArrowUpRight size={12} /></Link>
            <Link to="/register" className="button button-small nav-cta">Get started <ArrowRight size={14} /></Link>
          </div>
          <button className="mobile-menu md:hidden" onClick={() => setMobileOpen(!mobileOpen)} aria-label={mobileOpen ? 'Close menu' : 'Open menu'}>
            {mobileOpen ? <X /> : <Menu />}
          </button>
        </div>
        {mobileOpen && (
          <div className="mobile-nav md:hidden">
            <a href="#features" onClick={() => setMobileOpen(false)}>Features</a>
            <a href="#security" onClick={() => setMobileOpen(false)}>Security</a>
            <a href="#how-it-works" onClick={() => setMobileOpen(false)}>How it works</a>
            <a href="#roadmap" onClick={() => setMobileOpen(false)}>Roadmap</a>
            <a href="/login">Log in</a>
            <Link to="/register" className="button button-small justify-center">Get started <ArrowRight size={14} /></Link>
          </div>
        )}
      </nav>

      <section id="top" className="hero-section">
        <div className="hero-grid" />
        <div className="container-custom relative grid items-center gap-14 pb-20 pt-20 lg:grid-cols-[0.88fr_1.12fr] lg:gap-8 lg:pb-28 lg:pt-28">
          <div className="hero-copy">
            <div className="eyebrow"><span className="eyebrow-dot" /> The intelligent file workspace</div>
            <h1>Your files are only the <span>beginning.</span></h1>
            <p className="hero-lede">NimbusVault is a secure home for your files today — and the intelligent document workspace your team can grow into tomorrow.</p>
            <div className="flex flex-wrap items-center gap-4">
              <Link to="/register" className="button">Create your workspace <ArrowRight size={16} /></Link>
              <a href="#features" className="text-link">Explore the platform <ChevronDown size={15} /></a>
            </div>
            <div className="hero-proof">
              <div className="proof-avatars"><span>NV</span><span>AI</span><span>∞</span></div>
              <p>Built on a foundation for <strong>secure, thoughtful software.</strong></p>
            </div>
          </div>
          <div className="hero-art"><VaultVisual /></div>
        </div>
        <div className="container-custom"><ProductPreview /></div>
      </section>

      <section className="stack-strip">
        <div className="container-custom">
          <div className="strip-label">A foundation built with</div>
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
              <p className="section-kicker">A better starting point</p>
              <h2>Storage that makes room for <em>understanding.</em></h2>
            </div>
            <p className="section-intro">The essential tools to bring order to your files, with an architecture ready for the next layer of intelligence.</p>
          </div>
          <div className="feature-grid">
            {features.map((feature) => (
              <article className={cn('feature-card', feature.accent)} key={feature.title}>
                <div className="feature-icon"><feature.icon size={19} /></div>
                <div className="feature-label">{feature.eyebrow}</div>
                <h3>{feature.title}</h3>
                <p>{feature.body}</p>
                <span className="card-arrow"><ArrowRight size={15} /></span>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="showcase-section reveal-section" data-reveal>
        <div className="container-custom">
          <div className="showcase-copy">
            <p className="section-kicker">A glimpse of what&apos;s ahead</p>
            <h2>Your workspace, with a little more <em>signal.</em></h2>
            <p>Search, browse and understand your content from one considered surface. The interface is illustrative today; the direction is very real.</p>
          </div>
          <div className="showcase-wrap"><ProductPreview /></div>
        </div>
      </section>

      <section className="section-pad workflow-section reveal-section" data-reveal id="how-it-works">
        <div className="container-custom">
          <div className="section-heading centered">
            <div>
              <p className="section-kicker">Simple by design</p>
              <h2>From scattered to <em>clear.</em></h2>
            </div>
            <p className="section-intro">A workflow that stays out of the way, so your ideas can move forward.</p>
          </div>
          <div className="steps">
            <div className="step"><span>01</span><div className="step-icon"><UploadCloud size={21} /></div><h3>Store and organize</h3><p>Bring your files into a secure, structured home with a folder system that feels familiar.</p></div>
            <div className="step-line" />
            <div className="step"><span>02</span><div className="step-icon"><Network size={21} /></div><h3>Share and collaborate</h3><p>Give teammates the context they need with thoughtful controls and clear ownership.</p></div>
            <div className="step-line" />
            <div className="step"><span>03</span><div className="step-icon"><Sparkles size={21} /></div><h3>Search and understand</h3><p>Turn a library of documents into answers, insights and momentum when the AI layer arrives.</p></div>
          </div>
        </div>
      </section>

      <section className="security-section reveal-section" data-reveal id="security">
        <div className="container-custom grid items-center gap-14 lg:grid-cols-[0.92fr_1.08fr]">
          <div>
            <p className="section-kicker">Trust is a feature</p>
            <h2>A strong foundation is <em>non-negotiable.</em></h2>
            <p className="body-copy">NimbusVault is built with security fundamentals in mind from the first request to the last document.</p>
            <Link to="/register" className="text-link">Start with a secure workspace <ArrowRight size={15} /></Link>
          </div>
          <div className="security-list">
            <div className="security-list-glow" />
            {['JWT authentication with short-lived access tokens', 'Refresh-token rotation with reuse detection', 'Protected routes and validated input boundaries', 'Security headers and sensible platform defaults', 'Rate limiting at sensitive request boundaries'].map((item, index) => (
              <button
                className={cn('security-item', activeSecurity === index ? 'expanded' : '')}
                key={item}
                onClick={() => setActiveSecurity(activeSecurity === index ? null : index)}
                aria-expanded={activeSecurity === index}
              >
                <div className="check-icon"><Check size={14} /></div>
                <span>{item}</span>
                <Plus size={14} className="security-plus" />
                {activeSecurity === index && (
                  <small>
                    {index === 0 ? 'Sessions are scoped and intentionally short-lived.' :
                    index === 1 ? 'Reuse detection helps protect refresh boundaries.' :
                    'Every boundary is treated as a product surface.'}
                  </small>
                )}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="ai-section reveal-section" data-reveal>
        <div className="container-custom grid items-center gap-12 lg:grid-cols-[1fr_0.92fr]">
          <div className="ai-visual">
            <div className="ai-visual-grid" />
            <div className="ai-orb"><Sparkles size={31} /><span>AI</span></div>
            <div className="ai-pill pill-left">Text extraction</div>
            <div className="ai-pill pill-right">Embeddings</div>
            <div className="ai-pill pill-bottom">Grounded Q&A</div>
          </div>
          <div>
            <p className="section-kicker">The intelligent layer</p>
            <h2>Not just where files live. <em>What they know.</em></h2>
            <p className="body-copy">The roadmap leads from document text extraction to embeddings, semantic search and grounded Q&A — helping your knowledge work harder without losing its source.</p>
            <div className="vision-list">
              <span><Zap size={15} /> Retrieval with context</span>
              <span><ShieldCheck size={15} /> Answers you can trace</span>
              <span><Search size={15} /> Meaning over keywords</span>
            </div>
          </div>
        </div>
      </section>

      <section className="section-pad roadmap-section reveal-section" data-reveal id="roadmap">
        <div className="container-custom">
          <div className="section-heading">
            <div>
              <p className="section-kicker">The path forward</p>
              <h2>Built in layers, <em>on purpose.</em></h2>
            </div>
            <p className="section-intro">A transparent roadmap from dependable foundation to a document workspace that can think alongside you.</p>
          </div>
          <div className="roadmap">
            <div className="roadmap-progress" />
            <div className="roadmap-item complete">
              <div className="roadmap-marker"><Check size={14} /></div>
              <div><span>Foundation · complete</span><h3>Secure authentication</h3><p>Protected access, session boundaries and a clean platform core.</p></div>
            </div>
            <div className="roadmap-item active">
              <div className="roadmap-marker"><span /></div>
              <div><span>Next · in progress</span><h3>Cloud storage and file management</h3><p>A reliable home for every file, folder and version.</p></div>
            </div>
            <div className="roadmap-item">
              <div className="roadmap-marker" />
              <div><span>Then · planned</span><h3>Collaboration and sharing</h3><p>Bring teams into the workspace with confidence and control.</p></div>
            </div>
            <div className="roadmap-item">
              <div className="roadmap-marker" />
              <div><span>Vision · planned</span><h3>AI search and RAG</h3><p>Make every document discoverable, understandable and useful.</p></div>
            </div>
          </div>
        </div>
      </section>

      <section className="trust-section reveal-section" data-reveal>
        <div className="container-custom">
          <div className="trust-intro">
            <p className="section-kicker">Built for serious work</p>
            <h2>Calm systems create <em>better momentum.</em></h2>
            <p>From first upload to final answer, NimbusVault keeps your files legible, protected, and ready for the next useful action.</p>
          </div>
          <div className="trust-stats">
            <div><strong>10 GB</strong><span>workspace capacity</span></div>
            <div><strong>99.9%</strong><span>sync confidence</span></div>
            <div><strong>24/7</strong><span>protected access</span></div>
          </div>
        </div>
      </section>

      <section className="faq-section section-pad reveal-section" data-reveal id="faq">
        <div className="container-custom">
          <div className="section-heading">
            <div>
              <p className="section-kicker">Clear by design</p>
              <h2>Questions before you <em>begin.</em></h2>
            </div>
            <p className="section-intro">The useful details, without the enterprise fog.</p>
          </div>
          <div className="faq-list">
            {[
              ['Is NimbusVault secure?', 'Yes. The platform is designed around protected routes, short-lived sessions, validated inputs, and clear workspace boundaries.'],
              ['Can I organize files by folder?', 'Yes. The workspace preview reflects the core model: folders, file metadata, search, and a calm browsing surface.'],
              ['Will AI read everything automatically?', 'No. The intelligent layer is designed to be grounded in your selected content and traceable back to its sources.'],
              ['Can I start with a small team?', 'Yes. NimbusVault is designed to grow from a focused personal workspace into controlled team collaboration.'],
            ].map(([question, answer], index) => (
              <div className={cn('faq-item', openFaq === index ? 'open' : '')} key={question}>
                <button onClick={() => setOpenFaq(openFaq === index ? null : index)} aria-expanded={openFaq === index}>
                  <span>{question}</span>
                  <Plus size={17} />
                </button>
                {openFaq === index && <p>{answer}</p>}
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
            <h2>Give your files a <em>future.</em></h2>
            <p>Start building a calmer, more intelligent way to work with the things you create.</p>
            <div className="flex flex-wrap justify-center gap-4">
              <Link to="/register" className="button">Create your workspace <ArrowRight size={16} /></Link>
              <a href="https://github.com/JainMehul05/NimbusVault-" target="_blank" rel="noreferrer" className="button button-ghost">Explore the codebase <GitBranch size={15} /></a>
            </div>
          </div>
        </div>
      </section>

      <footer className="site-footer">
        <div className="container-custom flex flex-col gap-8 py-10 md:flex-row md:items-center md:justify-between">
          <div>
            <Logo />
            <p className="mt-3 text-xs text-slate-500">A secure home for what&apos;s next.</p>
          </div>
          <div className="footer-links">
            <a href="#features">Features</a>
            <a href="#security">Security</a>
            <a href="/login">Log in</a>
            <a href="/register">Register</a>
            <a href="https://github.com/JainMehul05/NimbusVault-" target="_blank" rel="noreferrer">GitHub <ArrowUpRightIcon /></a>
          </div>
          <p className="text-xs text-slate-600">© 2026 NimbusVault AI</p>
        </div>
      </footer>
    </main>
  )
}