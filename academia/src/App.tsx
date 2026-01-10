import Learn from "./Learn";

function App() {
  return (
    <>
      <header className="site-header">
        <div className="brand">
          <svg className="eagle" viewBox="0 0 64 64" aria-hidden>
            <path
              d="M32 4c-4 6-12 10-16 18 6-2 10-2 16 0 6-2 10-2 16 0-4-8-12-12-16-18z"
              fill="currentColor"
            />
          </svg>
          <div className="title">IMPERIUM</div>
        </div>

        <nav className="main-tabs" aria-label="Principal">
          <a className="tab" href="http://127.0.0.1:5500/atlas-site/">
            Atlas
          </a>
          <a className="tab active" href="http://localhost:5173/">
            Academia
          </a>
          <a className="tab" href="http://127.0.0.1:5500/ordem/">
            Ordem
          </a>
          <a className="tab" href="http://127.0.0.1:5500/alexandria/">
            Scrinium
          </a>
        </nav>

        <nav className="admin-links" aria-label="Institucional">
          <a href="/atlas-site/index.html#sobre">Sobre</a>
          <a href="/atlas-site/index.html#manifesto">Manifesto</a>
          <a href="/atlas-site/index.html#metodologia">Metodologia</a>
          <a href="/atlas-site/index.html#arquivo">Arquivo</a>
        </nav>
      </header>
      <Learn />
    </>
  );
}

export default App
