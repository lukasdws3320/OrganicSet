import {
  Send, Command, Ellipsis, Film, History, House, Keyboard, LayoutGrid, LibraryBig, Moon, Plus, Search, Settings2, Sparkles, Sun, UserSearch, Users, Workflow,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useState, type MouseEvent, type ReactNode } from "react";
import { Atalhos } from "./components/Atalhos";
import { CommandPalette, type PaletteNav } from "./components/CommandPalette";
import { fmtBytes, isTyping, navigate, setTheme, theme, useApi, useLocation, useStore } from "./lib";
import { ClientPage, ExpertPage, Experts } from "./pages/Clients";
import { FunilEditor } from "./pages/FunilEditor";
import { ABAS_FUNIS, Funis, type AbaFunis } from "./pages/Funis";
import { Postar } from "./pages/Postar";
import { Hoje } from "./pages/Hoje";
import { ImportSheet, Import } from "./pages/Import";
import { Biblioteca, type Aba } from "./pages/Library";
import { PerfilPage, Perfis } from "./pages/Perfis";
import { Prompts } from "./pages/Prompts";
import { CarrosselPage } from "./pages/Carrossel";
import { Tarefas, TarefasIcon } from "./pages/Tarefas";
import { Estudio, Producao } from "./pages/Replicacoes";
import { Settings } from "./pages/Settings";
import { useTriagemFila } from "./pages/Triagem";
import { Viewer } from "./pages/Viewer";
import { estudioAba, rotas } from "./replication-experts";
import { NovaReplicacao } from "./replication";
import { Button, cx, IconButton, Popover, Toaster } from "./ui";

// O App usa as rotas novas: os links de Produção/Estúdio/Experts saem em /producao?expert=, /producao/:id/:aba, /experts/:slug.
rotas.v2 = true;

// ---------- mapa de navegação (SPEC §5.1) ----------

type NavItem = { to: string; label: string; icon: typeof House; match: (path: string) => boolean };

const NAV: NavItem[] = [
  { to: "/", label: "Hoje", icon: House, match: (p) => p === "/" },
  { to: "/postar", label: "Postar", icon: Send, match: (p) => p === "/postar" },
  { to: "/tarefas", label: "Tarefas", icon: TarefasIcon, match: (p) => p === "/tarefas" },
  { to: "/biblioteca", label: "Biblioteca", icon: LayoutGrid, match: (p) => p === "/biblioteca" },
  { to: "/producao", label: "Produção", icon: Film, match: (p) => p === "/producao" || p.startsWith("/producao/") || p.startsWith("/carrossel/") },
  { to: "/experts", label: "Experts", icon: Users, match: (p) => p === "/experts" || p.startsWith("/experts/") },
  { to: "/funis", label: "Funis", icon: Workflow, match: (p) => p === "/funis" || p.startsWith("/funis/") },
];
const FERRAMENTAS: NavItem[] = [
  { to: "/perfis", label: "Perfis", icon: UserSearch, match: (p) => p === "/perfis" || p.startsWith("/perfis/") },
  { to: "/prompts", label: "Prompts", icon: Sparkles, match: (p) => p === "/prompts" },
  { to: "/configuracoes", label: "Configurações", icon: Settings2, match: (p) => p === "/configuracoes" },
];
const SUBABAS: { aba: Aba; label: string }[] = [
  { aba: "triagem", label: "Triagem" },
  { aba: "favoritas", label: "Favoritas" },
  { aba: "quadros", label: "Quadros" },
  { aba: "criadores", label: "Criadores" },
];

const PALETTE_NAV: PaletteNav[] = [
  ...NAV.map((n) => ({ to: n.to, label: n.label, icon: n.icon })),
  ...SUBABAS.map((s) => ({ to: `/biblioteca?aba=${s.aba}`, label: s.label, icon: LibraryBig, hint: "Biblioteca" })),
  ...FERRAMENTAS.map((n) => ({ to: n.to, label: n.label, icon: n.icon })),
  { to: "/importar", label: "Histórico de importação", icon: History },
];

// ---------- redirecionamentos das rotas antigas (SPEC §5.1) ----------

const withQs = (path: string, sp: URLSearchParams) => {
  const s = sp.toString();
  return s ? `${path}?${s}` : path;
};

/** Destino canônico de uma rota antiga, ou null se a rota já é a nova. Mantém a query (f, fluxo, visao…). */
export function redirectFor(path: string, search: string): string | null {
  const sp = new URLSearchParams(search);
  let m: RegExpMatchArray | null;
  if (path.length > 1 && path.endsWith("/")) return withQs(path.replace(/\/+$/, ""), sp);
  if (path === "/hoje" || path === "/dashboard") return withQs("/", sp);
  if (path === "/referencias") return withQs("/biblioteca", sp);
  if (path === "/favoritos") { sp.set("aba", "favoritas"); return withQs("/biblioteca", sp); }
  if ((m = path.match(/^\/colecoes(?:\/(\d+))?$/))) {
    sp.set("aba", "quadros");
    if (m[1]) sp.set("quadro", m[1]);
    return withQs("/biblioteca", sp);
  }
  if (path === "/replicacao") return withQs("/producao", sp);
  if ((m = path.match(/^\/replicacao\/([^/]+)$/))) {
    const aba = estudioAba(sp.get("aba"));
    sp.delete("aba");
    return withQs(`/producao/${m[1]}/${aba}`, sp);
  }
  if ((m = path.match(/^\/producao\/([^/]+)$/))) {
    if (m[1].includes("--")) { // estúdio sem aba
      const aba = estudioAba(sp.get("aba"));
      sp.delete("aba");
      return withQs(`/producao/${m[1]}/${aba}`, sp);
    }
    sp.set("expert", m[1]);
    return withQs("/producao", sp);
  }
  if ((m = path.match(/^\/clientes(\/.*)?$/))) return withQs(`/experts${m[1] ?? ""}`, sp);
  return null;
}

const ABAS: Aba[] = ["todas", "triagem", "favoritas", "quadros", "criadores"];

function Page({ path, search }: { path: string; search: string }) {
  const sp = new URLSearchParams(search);
  let m: RegExpMatchArray | null;
  if (path === "/") return <Hoje />;
  if (path === "/postar") return <Postar />;
  if (path === "/biblioteca") {
    const aba = sp.get("aba") as Aba | null;
    const quadro = Number(sp.get("quadro")) || undefined;
    return <Biblioteca aba={aba && ABAS.includes(aba) ? aba : "todas"} quadro={quadro} />;
  }
  if (path === "/producao") return <Producao expert={sp.get("expert")} visao={sp.get("visao")} />;
  if ((m = path.match(/^\/producao\/([^/]+--[^/]+)\/([\w-]+)$/))) return <Estudio key={m[1]} id={m[1]} aba={m[2]} />;
  if ((m = path.match(/^\/carrossel\/([\w-]+)$/))) return <CarrosselPage key={m[1]} id={m[1]} />;
  if (path === "/tarefas") return <Tarefas />;
  if (path === "/experts") return <Experts />;
  if ((m = path.match(/^\/experts\/(\d+)$/))) return <ClientPage id={Number(m[1])} />;
  if ((m = path.match(/^\/experts\/([\w-]+)(?:\/([\w-]+))?$/))) return <ExpertPage key={m[1]} slug={m[1]} aba={m[2] ?? sp.get("aba") ?? undefined} />;
  if (path === "/funis") {
    const aba = sp.get("aba") as AbaFunis | null;
    return <Funis aba={aba && ABAS_FUNIS.includes(aba) ? aba : "funis"} expert={sp.get("expert") ?? ""} />;
  }
  if ((m = path.match(/^\/funis\/([\w-]+)$/))) return <FunilEditor key={m[1]} id={m[1]} />;
  if (path === "/perfis") {
    const uso = sp.get("uso");
    return <Perfis uso={uso === "inspiracao" || uso === "analise" || uso === "referencia" ? uso : null} />;
  }
  if ((m = path.match(/^\/perfis\/([\w.]+)$/))) return <PerfilPage key={m[1]} handle={m[1]} />;
  if (path === "/prompts") return <Prompts />;
  if (path === "/importar") return <Import />;
  if (path === "/configuracoes") return <Settings />;
  return (
    <div className="py-24 text-center">
      <h1 className="title-serif text-[34px]">Página não <em>encontrada</em></h1>
      <p className="num mt-2 text-[12px] text-ink-3">{path}</p>
      <div className="mt-5 flex justify-center"><Button variant="secondary" onClick={() => navigate("/")}>Ir para Hoje</Button></div>
    </div>
  );
}

const linkTo = (to: string, after?: () => void) => (e: MouseEvent) => {
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
  e.preventDefault();
  after?.();
  navigate(to);
};

function useIsMobile() {
  const q = "(max-width: 767px)";
  const [m, setM] = useState(() => typeof matchMedia !== "undefined" && matchMedia(q).matches);
  useEffect(() => {
    const mq = matchMedia(q);
    const on = () => setM(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return m;
}

// ---------- App ----------

export function App() {
  const loc = useLocation();
  const viewer = loc.path.match(/^\/ref\/([\w-]+)$/);

  // Rota antiga → nova (replace: o botão Voltar não volta para a rota velha).
  const red = viewer ? null : redirectFor(loc.path, loc.search);
  useLayoutEffect(() => { if (red) navigate(red, { replace: true, state: loc.state ?? undefined }); }, [red]); // eslint-disable-line react-hooks/exhaustive-deps

  // Com o viewer aberto, a página de fundo é a que estava por trás (normalizada para a rota nova).
  const bgRaw: string = viewer ? loc.state?.bg ?? "/biblioteca" : loc.path + loc.search;
  const bgCanon = viewer ? redirectFor(bgRaw.split("?")[0], bgRaw.includes("?") ? bgRaw.slice(bgRaw.indexOf("?")) : "") ?? bgRaw : bgRaw;
  const qi = bgCanon.indexOf("?");
  const bgPath = qi < 0 ? bgCanon : bgCanon.slice(0, qi);
  const bgSearch = qi < 0 ? "" : bgCanon.slice(qi);

  const [palette, setPalette] = useState(false);
  const [atalhos, setAtalhos] = useState(false);
  const [importar, setImportar] = useState(false);
  const [replicar, setReplicar] = useState<string | null>(null);
  const mobile = useIsMobile();

  const abrirImportar = useCallback(() => { setPalette(false); setImportar(true); }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if ((e.metaKey || e.ctrlKey) && !e.altKey && k === "k") { e.preventDefault(); setPalette((p) => !p); return; }
      if ((e.metaKey || e.ctrlKey) && !e.altKey && k === "i") { e.preventDefault(); abrirImportar(); return; }
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e) || document.querySelector(".modal")) return;
      if (e.key === "?") { e.preventDefault(); setAtalhos(true); return; }
      const path = location.pathname;
      // A Biblioteca trata "/" e "T" enquanto está montada; nas outras telas, o atalho é global.
      if (path === "/biblioteca" || path.startsWith("/ref/")) return;
      if (k === "t") { e.preventDefault(); navigate("/biblioteca?aba=triagem"); }
      else if (e.key === "/") { e.preventDefault(); setPalette(true); }
    };
    const onImportar = () => abrirImportar();
    window.addEventListener("keydown", onKey);
    window.addEventListener("irh:importar", onImportar);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("irh:importar", onImportar); };
  }, [abrirImportar]);

  return (
    <div className="min-h-dvh bg-paper text-ink md:pl-[232px]">
      <Sidebar path={bgPath} search={bgSearch} onAtalhos={() => setAtalhos(true)} />
      <TopBar onPalette={() => setPalette(true)} onImportar={abrirImportar} />
      <main className="mx-auto max-w-[1600px] px-4 pt-4 pb-28 sm:px-8 md:pb-16 lg:px-10 lg:pt-6">
        {/* Desktop: o viewer é painel lateral e a grade continua clicável. Mobile: tela cheia, fundo inerte. */}
        <div aria-hidden={(viewer && mobile) || undefined} inert={(viewer && mobile) || undefined}>
          {!red && <Page path={bgPath} search={bgSearch} />}
        </div>
      </main>
      <MobileBar path={bgPath} onAtalhos={() => setAtalhos(true)} onPalette={() => setPalette(true)} />
      {viewer && <Viewer id={viewer[1]} />}
      {palette && (
        <CommandPalette nav={PALETTE_NAV} viewerId={viewer?.[1] ?? null} onClose={() => setPalette(false)}
          onImportar={abrirImportar} onAtalhos={() => setAtalhos(true)} onReplicar={(id) => setReplicar(id)} />
      )}
      {importar && <ImportSheet onClose={() => setImportar(false)} />}
      {atalhos && <Atalhos onClose={() => setAtalhos(false)} />}
      {replicar && <NovaReplicacao refInicial={replicar} onClose={() => setReplicar(null)} />}
      <Toaster />
    </div>
  );
}

// ---------- barra superior: busca ⌘K + Importar ⌘I ----------

function TopBar({ onPalette, onImportar }: { onPalette: () => void; onImportar: () => void }) {
  const t = useStore(theme);
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-paper/95 backdrop-blur-sm md:border-b-0 md:bg-paper">
      <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-2 px-4 sm:px-8 md:h-16 lg:px-10">
        <a href="/" onClick={linkTo("/")} className="mr-1 shrink-0 md:hidden" aria-label="Reference Hub · Hoje">
          <span className="mark block h-[30px] w-[50px]" style={{ ["--src" as string]: "url(/brand/assinatura-branca.svg)" }} aria-hidden />
        </a>
        <button type="button" onClick={onPalette} aria-label="Buscar ou agir (⌘K)" aria-keyshortcuts="Meta+K"
          className="flex h-[var(--hit)] min-w-0 flex-1 items-center gap-2 rounded-r2 border border-line-2 bg-card px-3 text-left text-[13px] text-ink-3 transition-colors hover:border-ink-3 hover:text-ink-2 md:max-w-[460px]">
          <Search size={15} strokeWidth={1.5} aria-hidden className="shrink-0" />
          <span className="min-w-0 flex-1 truncate"><span className="sm:hidden">Buscar ou agir</span><span className="hidden sm:inline">Buscar REF, expert, @criador ou ação…</span></span>
          <kbd className="num hidden items-center gap-0.5 rounded-r1 border border-line px-1.5 text-[11px] sm:inline-flex"><Command size={11} aria-hidden />K</kbd>
        </button>
        <span className="hidden flex-1 md:block" />
        <IconButton className="hidden md:inline-grid" label={t === "dark" ? "Mudar para tema claro" : "Mudar para tema escuro"} onClick={() => setTheme(t === "dark" ? "light" : "dark")}>
          {t === "dark" ? <Sun size={17} strokeWidth={1.5} /> : <Moon size={17} strokeWidth={1.5} />}
        </IconButton>
        <Button variant="accent" icon={<Plus size={16} strokeWidth={2} aria-hidden />} kbd="⌘I" onClick={onImportar} aria-keyshortcuts="Meta+I"
          aria-label="Importar (⌘I)" className="shrink-0 max-sm:[&>kbd]:hidden max-sm:[&>span]:sr-only max-sm:px-0 max-sm:w-[var(--hit)] max-sm:justify-center">
          Importar
        </Button>
      </div>
    </header>
  );
}

// ---------- lateral (desktop) ----------

function NavLink({ item, on, count, sub }: { item: { to: string; label: string; icon?: typeof House }; on: boolean; count?: number | null; sub?: boolean }) {
  return (
    <a href={item.to} onClick={linkTo(item.to)} aria-current={on ? "page" : undefined}
      className={cx(
        "flex items-center gap-3 rounded-r2 text-[13.5px] transition-colors duration-150",
        sub ? "h-8 pr-3 pl-10 text-[13px]" : "h-9 px-3",
        on ? "bg-card font-medium text-ink shadow-[var(--sh-1)]" : "text-ink-2 hover:bg-sunken hover:text-ink",
      )}>
      {item.icon && <item.icon size={16} strokeWidth={1.5} aria-hidden className={on ? "text-ink" : "text-ink-3"} />}
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {count != null && <span className={cx("num text-[11px]", on ? "text-ink-2" : "text-ink-3")}>{count}</span>}
    </a>
  );
}

function Sidebar({ path, search, onAtalhos }: { path: string; search: string; onAtalhos: () => void }) {
  const stats = useApi<{ total?: number; favorites_count?: number }>("/api/stats").data;
  const storage = useApi<{ parts: Record<string, number>; free: number | null }>("/api/storage").data;
  const profiles = useApi<unknown[]>("/api/profiles").data;
  const pipeline = useApi<{ itens: { stage: string }[] }>("/api/pipeline").data;
  const fila = useTriagemFila();
  const aba = path === "/biblioteca" ? new URLSearchParams(search).get("aba") ?? "todas" : null;
  const ativos = pipeline?.itens.filter((i) => i.stage !== "postada").length;
  const counts: Partial<Record<string, number | null | undefined>> = {
    "/biblioteca": stats?.total, "/producao": ativos, "/experts": profiles?.length,
  };
  const subCounts: Partial<Record<Aba, number | null | undefined>> = { triagem: fila.total, favoritas: stats?.favorites_count };

  return (
    <nav aria-label="Navegação principal" className="fixed inset-y-0 left-0 z-30 hidden w-[232px] flex-col border-r border-line bg-paper md:flex">
      <a href="/" onClick={linkTo("/")} className="block px-6 pt-6 pb-5" aria-label="Reference Hub · Hoje">
        <span className="mark block h-[64px] w-[104px]" style={{ ["--src" as string]: "url(/brand/assinatura-branca.svg)" }} aria-hidden />
        <span className="eyebrow mt-2 block text-[10px]">Reference Hub</span>
      </a>

      <ul className="flex flex-col gap-0.5 px-3">
        {NAV.map((n) => (
          <li key={n.to}>
            <NavLink item={n} on={n.to === "/biblioteca" ? aba === "todas" : n.match(path)} count={counts[n.to]} />
            {n.to === "/biblioteca" && (
              <ul className="mt-0.5 mb-1 flex flex-col gap-0.5" aria-label="Abas da biblioteca">
                {SUBABAS.map((s) => (
                  <li key={s.aba}>
                    <NavLink sub item={{ to: `/biblioteca?aba=${s.aba}`, label: s.label }} on={aba === s.aba} count={subCounts[s.aba]} />
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>

      <p className="eyebrow mt-6 mb-1.5 px-6 text-[10px]">Ferramentas</p>
      <ul className="flex flex-col gap-0.5 px-3">
        {FERRAMENTAS.map((n) => <li key={n.to}><NavLink item={n} on={n.match(path)} /></li>)}
      </ul>

      <div className="mt-auto border-t border-line px-6 py-4">
        {storage && (
          <p className="num text-[11px] leading-relaxed text-ink-3">
            Biblioteca local · {fmtBytes(storage.parts.videos + storage.parts.thumbnails + storage.parts.database)}
            {storage.free != null && <><br />{fmtBytes(storage.free)} livres no disco</>}
          </p>
        )}
        <button type="button" onClick={onAtalhos} className="btn btn--ghost btn--sm mt-2 -ml-2" aria-keyshortcuts="?">
          <Keyboard size={14} strokeWidth={1.5} aria-hidden /><span>Atalhos</span><kbd>?</kbd>
        </button>
      </div>
    </nav>
  );
}

// ---------- barra inferior (mobile): 5 itens, Configurações no Mais ----------

function MobileBar({ path, onAtalhos, onPalette }: { path: string; onAtalhos: () => void; onPalette: () => void }) {
  const t = useStore(theme);
  const mobileNav = NAV.slice(0, 5);
  const mobileExtra = NAV.slice(5);
  const maisOn = [...FERRAMENTAS, ...mobileExtra].some((n) => n.match(path));
  const item = (n: NavItem) => {
    const on = n.match(path) || (n.to === "/biblioteca" && path === "/biblioteca");
    return (
      <a key={n.to} href={n.to} onClick={linkTo(n.to)} aria-current={on ? "page" : undefined}
        className={cx("flex h-14 min-w-0 flex-1 flex-col items-center justify-center gap-1 text-[11px]", on ? "font-medium text-ink" : "text-ink-3")}>
        <n.icon size={20} strokeWidth={on ? 1.9 : 1.5} aria-hidden />
        <span className="truncate">{n.label}</span>
      </a>
    );
  };
  const mais: { label: string; icon: ReactNode; run: () => void; on?: boolean }[] = [
    ...[...mobileExtra, ...FERRAMENTAS].map((n) => ({ label: n.label, icon: <n.icon size={17} strokeWidth={1.5} aria-hidden />, run: () => navigate(n.to), on: n.match(path) })),
    { label: "Buscar ou agir", icon: <Search size={17} strokeWidth={1.5} aria-hidden />, run: onPalette },
    { label: t === "dark" ? "Tema claro" : "Tema escuro", icon: t === "dark" ? <Sun size={17} strokeWidth={1.5} aria-hidden /> : <Moon size={17} strokeWidth={1.5} aria-hidden />, run: () => setTheme(t === "dark" ? "light" : "dark") },
    { label: "Atalhos", icon: <Keyboard size={17} strokeWidth={1.5} aria-hidden />, run: onAtalhos },
  ];
  return (
    <nav aria-label="Navegação" className="fixed inset-x-0 bottom-0 z-30 flex border-t border-line bg-paper/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-sm md:hidden">
      {mobileNav.map(item)}
      <div className="flex min-w-0 flex-1">
        <Popover align="end" width={240} className="flex flex-1 [&>.pop]:top-auto [&>.pop]:bottom-full [&>.pop]:mb-2" trigger={({ open, toggle }) => (
          <button type="button" onClick={toggle} aria-expanded={open} aria-haspopup="menu"
            className={cx("flex h-14 w-full flex-col items-center justify-center gap-1 text-[11px]", maisOn ? "font-medium text-ink" : "text-ink-3")}>
            <Ellipsis size={20} strokeWidth={1.5} aria-hidden /> Mais
          </button>
        )}>
          {(close) => (
            <ul className="pop-list" role="menu">
              {mais.map((m) => (
                <li key={m.label} role="none">
                  <button type="button" role="menuitem" aria-current={m.on ? "page" : undefined} onClick={() => { close(); m.run(); }} className="pop-opt min-h-11">
                    <span className="text-ink-3">{m.icon}</span><span className="lb">{m.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Popover>
      </div>
    </nav>
  );
}
