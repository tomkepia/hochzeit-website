import React from "react";

function RSVPForm() {
  return (
    <section>
      <h2>Deine Rückmeldung</h2>
      <form>
        {/* 1. Name */}
        <label>
          Name:
          <input type="text" name="name" required />
        </label>

        {/* 2. Essenswünsche */}
        <label>
          Essenswunsch:
          <input
            type="text"
            name="essen"
            placeholder="z.B. vegan, vegetarisch oder alles"
          />
        </label>

        {/* 3. Anreise */}
        <fieldset>
          <legend>Anreise</legend>
          <p>Wann kommt ihr an?</p>
          <label>
            <input type="checkbox" name="anreise" value="freitag" />
            Freitag
          </label>
          <label>
            <input type="checkbox" name="anreise" value="samstag" />
            Samstag
          </label>

          <p>Verpflegung:</p>
          <label>
            <input type="checkbox" name="essen_freitag" value="freitag_abend" />
            Freitag Abendessen
          </label>
          <label>
            <input type="checkbox" name="essen_samstag" value="samstag_frühstück" />
            Samstag Frühstück
          </label>
          <label>
            <input type="checkbox" name="essen_sonntag" value="sonntag_frühstück" />
            Sonntag Frühstück
          </label>
        </fieldset>

        {/* 4. Schlafplatz */}
       <fieldset>
        <legend>Schlafplatz</legend>
        <p>Bitte wähle:</p>
        <label className="horizontal-label">
          <input type="radio" name="schlafplatz" value="hotel" /> Hotel
        </label>
        <label className="horizontal-label">
          <input type="radio" name="schlafplatz" value="vor_ort" /> Vor Ort im Zimmer
        </label>
        <label className="horizontal-label">
          <input type="radio" name="schlafplatz" value="camping" /> Camping/Bulli/Wohnwagen
        </label>
        </fieldset>

        {/* 5. Mitbringen für Frühstück */}
        <fieldset>
          <legend>Frühstück Fingerfood</legend>
          <p>
            Wir kümmern uns um Brötchen, Butter, Aufstriche. Bitte bringt etwas mit für Fingerfood:
          </p>
          <p>Vorschläge: Obst, Gemüse-Sticks, Käsewürfel, Aufschnitt, Muffins, Croissants, Joghurt, Nüsse, kleine Sandwiches.</p>
          <input
            type="text"
            name="fruehstueck"
            placeholder="Was möchtest du mitbringen?"
          />
        </fieldset>

        <button type="submit">Absenden</button>
      </form>
    </section>
  );
}

export default RSVPForm;
