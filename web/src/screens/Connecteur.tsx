import { useState } from "react";
import type { Household } from "../types";

type Outil = "claude" | "chatgpt";

/**
 * Step-by-step guide to plug Nidou into the family's own AI assistant (Claude or ChatGPT) through the MCP connector.
 * Menu names follow the apps as of autumn 2026; they move from time to time, hence the "if you can't find it" notes.
 */
export function Connecteur({ household, onBack, go, toast }: { household: Household; onBack: () => void; go: (s: string) => void; toast: (m: string) => void }) {
  const [outil, setOutil] = useState<Outil>("claude");
  const base = `${location.origin}/mcp`;
  const adresse = household.mcp_token ? `${base}/${household.mcp_token}` : null;
  const copier = async (v: string, quoi: string) => { try { await navigator.clipboard.writeText(v); toast(`${quoi} copié${quoi === "Adresse" ? "e" : ""}`); } catch { toast(v); } };

  const etapes: Record<Outil, { titre: string; texte: React.ReactNode }[]> = {
    claude: [
      { titre: "Ouvrez Claude sur un ordinateur", texte: <>Sur claude.ai ou l'application Claude pour Mac ou Windows. L'ajout se fait une seule fois, il reste ensuite attaché à votre compte Claude. Le compte gratuit de Claude accepte un connecteur personnalisé.</> },
      { titre: "Réglages, puis Connecteurs", texte: <>Cliquez sur votre nom en bas à gauche, <b>Réglages</b>, puis <b>Connecteurs</b>.</> },
      { titre: "Ajouter un connecteur personnalisé", texte: <>Nom : <b>Nidou</b>. Adresse : collez votre adresse personnelle (bouton ci-dessous). Validez.</> },
      { titre: "Activez-le dans une conversation", texte: <>Dans une nouvelle conversation, bouton <b>+</b> ou icône des outils, et cochez Nidou. Claude vous demandera votre accord la première fois qu'il lit vos papiers.</> },
      { titre: "Posez votre question", texte: <>« Quelles sont mes échéances ce mois-ci ? », « Rédige la lettre de résiliation de mon assurance auto », « Où est-ce que je peux économiser ? »</> },
    ],
    chatgpt: [
      { titre: "Vérifiez votre abonnement", texte: <>Les connecteurs personnalisés demandent ChatGPT Plus ou Pro (ou un compte Business dont l'administrateur les autorise). Ils s'ajoutent depuis le site chatgpt.com, sur ordinateur.</> },
      { titre: "Activez le mode développeur", texte: <>Votre nom en bas à gauche, <b>Réglages</b>, <b>Applications et connecteurs</b>, tout en bas <b>Paramètres avancés</b> : activez <b>Mode développeur</b>.</> },
      { titre: "Créez le connecteur", texte: <>Toujours dans <b>Applications et connecteurs</b>, bouton <b>Créer</b>. Nom : <b>Nidou</b>. URL : votre adresse personnelle. Authentification : <b>Aucune</b> (l'adresse contient déjà votre clé). Cochez « Je fais confiance à cette application », puis <b>Créer</b>.</> },
      { titre: "Utilisez-le dans une conversation", texte: <>Bouton <b>+</b> sous la zone de saisie, <b>Plus</b>, puis <b>Nidou</b>. ChatGPT affiche chaque lecture de vos papiers avant de la faire.</> },
      { titre: "Posez votre question", texte: <>« Mon assurance habitation est-elle chère ? », « Qu'est-ce qui arrive à échéance avant Noël ? »</> },
    ],
  };

  return (
    <div className="screen">
      <button className="back" onClick={onBack}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>Retour</button>
      <div className="top"><div><h1>Nidou dans votre IA</h1><p className="sub">Branchez vos papiers sur Claude ou ChatGPT, avec votre propre compte</p></div></div>

      <section className="section">
        <p>Vous avez déjà un compte Claude ou ChatGPT ? Ajoutez-y Nidou une fois : votre assistant pourra lire vos papiers, vos échéances et vos charges, en lecture seule. Chaque lecture est notée dans votre journal Nidou.</p>
        {adresse ? (
          <>
            <div className="settings-row"><div><div className="t">Votre adresse personnelle</div><div className="s">Elle ouvre vos papiers : ne la partagez pas. Vous pouvez la changer dans Réglages.</div></div><button className="link" onClick={() => copier(adresse, "Adresse")}>Copier</button></div>
            <div className="code" style={{ marginTop: 8 }}>{adresse}</div>
          </>
        ) : (
          <div className="confidence" style={{ marginTop: 6 }}>Votre adresse personnelle apparaît ici avec une formule Solo, Duo ou Tribu. <button className="link" onClick={() => go("settings")}>Voir les formules</button></div>
        )}
      </section>

      <div className="pills" role="group" aria-label="Assistant">
        <button className="pill" aria-pressed={outil === "claude"} onClick={() => setOutil("claude")}>Claude</button>
        <button className="pill" aria-pressed={outil === "chatgpt"} onClick={() => setOutil("chatgpt")}>ChatGPT</button>
      </div>

      <ol className="etapes">
        {etapes[outil].map((e, i) => (
          <li key={i}><span className="etape-num">{i + 1}</span><div><div className="t">{e.titre}</div><div className="s">{e.texte}</div>{i === 2 && adresse && <button className="link" style={{ marginTop: 6 }} onClick={() => copier(adresse, "Adresse")}>Copier mon adresse</button>}</div></li>
        ))}
      </ol>

      <section className="section">
        <div className="section-head"><h2>Bon à savoir</h2></div>
        <div className="settings-row"><div><div className="t">Ça ne coûte rien de plus</div><div className="s">Le connecteur est inclus dans votre formule. Les questions sont comptées sur votre abonnement Claude ou ChatGPT, pas sur Nidou.</div></div></div>
        <div className="settings-row"><div><div className="t">Santé et banque restent fermées</div><div className="s">Ces dossiers ne sont jamais transmis à l'assistant.</div></div></div>
        <div className="settings-row"><div><div className="t">Vous ne trouvez pas le menu ?</div><div className="s">Les applications changent parfois le nom de leurs menus. Cherchez « connecteur » ou « MCP » dans leurs réglages ou leur aide.</div></div></div>
        <div className="settings-row"><div><div className="t">Pas de compte IA ?</div><div className="s">L'assistant intégré à Nidou répond directement ici, sans autre compte.</div></div><button className="link" onClick={() => go("assistant")}>Découvrir</button></div>
      </section>
    </div>
  );
}
