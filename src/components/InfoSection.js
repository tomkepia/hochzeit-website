import React from "react";

function InfoSection() {
  return (
    <section className="info-section">
      <h2>Informationen zur Hochzeit</h2>
      <p className="intro-text">
        Wir heiraten und freuen uns riesig, unseren besonderen Tag mit euch zu feiern!
      </p>

      <div className="info-card">
        <h3>Datum</h3>
        <p>08. - 10. Mai 2026</p>
      </div>

      <div className="info-card">
        <h3>Ort</h3>
        <p>FarmInn, Kakerbeck 9, 29378 Wittingen</p>
      </div>
    <div className="info-card">
        <h3>Die Location</h3>
        <p>
          Auf dem Gelände gibt es ca. 70 Schlafmöglichkeiten (meist Mehrbettzimmer).  
          Einige Zimmer mit eigenem Bad, sonst Gemeinschaftsbäder mit Duschkabinen. 
          Die Preise der Zimmer schwanken je nach Größe ca. zwischen 42,5€ - 60€ pro Person/pro Nacht.
          Die Zimmeraufteilung übernehmen wir und besprechen diese dann natürlich mit euch. </p>
        <p> 
          Außerdem ist es möglich direkt auf dem Gelände mit einem Bulli oder Wohnwagen zu campen. 
          </p>
          <p>
            Für Übernachtungen im Hotel in der Nähe können wir das Hotel "Bennetts Restaurant und Hotel" in Wittingen empfehlen.
            Zusätzlich gibt es in der Umgebung einige Ferienwohnungen.
         </p>
         
      </div>
      <div className="info-card">
        <h3>Ablauf</h3>
        <p>
            <p>Wir wollen das ganze Wochenende mit euch feiern! Wenn ihr wollt, könnt ihr gerne schon am Freitag anreisen.</p>
          <strong>Freitag, 08. Mai:</strong> 
          <p> ab 17 Uhr gemütliches Beisammensein & wir kümmern uns um ein einfaches Abendessen. Wir würden uns freuen, wenn ihr eure Lieblingsgetränke selber mitbringt.</p>
          <strong>Samstag, 09. Mai:</strong> 
          <p>10 Uhr: Gemeinsames Frühstück</p>
          <p>14 Uhr: Freie Trauung</p>
          <p>15 Uhr: Sektempfang</p>
          <p>gegen 18:30 Uhr: Essen und anschließend Feiern bis spät in die Nacht</p>
          <strong>Sonntag, 10. Mai:</strong>
          <p>ca. 10 Uhr: Gemeinsames Frühstück und gemeinsamer Ausklang</p>
         
        </p>
      </div>

     
        <div className="info-card">
        <h3>Dresscode</h3>
        <p>
            Wir wollen, dass ihr euch wohlfühlt! Zieht also an, worin ihr euch am besten fühlt. Und bringt ganz viel gute Laune mit!
        </p>
      </div>
            <div className="info-card">
        <h3>Kontaktpersonen</h3>
        <p>
            Bei Fragen oder Ideen für unsere Hochzeit könnt ihr euch gerne bei unseren TrauzeugInnen melden oder direkt bei uns:
            <p><strong>Leo: </strong> 0179 6100655</p>
            <p><strong>Louisa: </strong> 01520 2968892</p>
            <p><strong>Jelka: </strong> 0176 56584221</p>
        </p>
      </div>


      <div className="info-card">
        <h3>Rückmeldung</h3>
        <p>
            Damit wir den ersten Abend, die Frühstücke und die Zimmeraufteilung besser planen können, 
            würden wir uns freuen, wenn ihr euch in das nachfolgende Formular eintragt. 
            Wir freuen uns sehr auf euch.
        </p>
      </div>

      <div className="email-hinweis">
        Bitte gebt eure <strong>Email-Adresse</strong> an, damit wir euch über wichtige Infos informieren können.
      </div>
    </section>
  );
}

export default InfoSection;
