export default function Support() {
  return (
    <main className="max-w-4xl mx-auto px-4 py-12">
      <h1 className="text-3xl font-bold text-white mb-2">Support</h1>
      <p className="text-gray-400 mb-10">Get help and stay connected with the community.</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        {LINKS.map(l => (
          <a
            key={l.title}
            href={l.href}
            target="_blank"
            rel="noreferrer"
            className="card hover:border-gray-700 transition-colors group block"
          >
            <div className="text-2xl mb-3">{l.icon}</div>
            <h3 className="text-white font-semibold group-hover:text-brand-400 transition-colors mb-1">{l.title}</h3>
            <p className="text-gray-500 text-sm">{l.desc}</p>
          </a>
        ))}
      </div>
    </main>
  )
}

const LINKS = [
  { icon: '🐛', title: 'GitHub Issues', href: 'https://github.com', desc: 'Report bugs or request features' },
  { icon: '💬', title: 'Discussions', href: 'https://github.com', desc: 'Ask questions and share ideas' },
  { icon: '📖', title: 'Documentation', href: '/wiki', desc: 'Read the architecture guide' },
  { icon: '📦', title: 'Releases', href: '/downloads', desc: 'Download the latest build' },
]
