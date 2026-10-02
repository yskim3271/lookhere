import { NavButton } from "./NavButton.jsx";

function Header() {
  return (
    <header>
      <div className="logo">Acme Notes</div>
      <nav>
        <a href="#">Features</a>
        <a href="#">Pricing</a>
        <NavButton>Sign up</NavButton>
      </nav>
    </header>
  );
}

function FeatureCard({ title, body }) {
  return (
    <article className="card">
      <h2>{title}</h2>
      <p>{body}</p>
    </article>
  );
}

export function App() {
  return (
    <>
      <Header />
      <section className="hero">
        <h1>Notes that keep up with you</h1>
      </section>
      <section className="cards">
        <FeatureCard title="Fast search" body="Find any note instantly." />
        <FeatureCard title="Backlinks" body="See how ideas connect." />
        <FeatureCard title="Offline" body="Works on a plane." />
      </section>
    </>
  );
}
