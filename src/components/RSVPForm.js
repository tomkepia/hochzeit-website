import React, { useState } from "react";

function RSVPForm() {
  const [persons, setPersons] = useState([{ name: "", essen: "", dabei: null }]);

  const handlePersonChange = (idx, field, value) => {
    const updated = persons.map((p, i) =>
      i === idx ? { ...p, [field]: value } : p
    );
    setPersons(updated);
  };

  const addPerson = () => {
    setPersons([...persons, { name: "", essen: "", dabei: null }]);
  };

  const [email, setEmail] = useState("");
  const [dabei, setDabei] = useState(null);
  const [anreise, setAnreise] = useState([]);
  const [essen_fr, setEssenFr] = useState(false);
  const [essen_sa, setEssenSa] = useState(false);
  const [essen_so, setEssenSo] = useState(false);
  const [unterkunft, setUnterkunft] = useState("");
  const [essen_mitbringsel, setEssenMitbringsel] = useState("");
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();

    const formData = new FormData(e.target);
    const anreiseArr = formData.getAll("anreise");
    const unterkunftVal = formData.get("schlafplatz");
    const dabeiVal = formData.get("zusage") === "ja";
    const sharedFields = {
      email: formData.get("email"),
      anreise: anreiseArr.join(","),
      essen_fr: !!formData.get("essen_freitag"),
      essen_sa: !!formData.get("essen_samstag"),
      essen_so: !!formData.get("essen_sonntag"),
      essen_mitbringsel: formData.get("fruehstueck"),
      unterkunft: unterkunftVal,
    };

    let allSuccess = true;
    for (const person of persons) {
      const guestData = {
        name: person.name,
        essenswunsch: person.essen,
        dabei: person.dabei === "ja",
        ...sharedFields,
      };
      try {
        const res = await fetch("http://localhost:8000/rsvp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(guestData),
        });
        if (!res.ok) {
          allSuccess = false;
        }
      } catch (err) {
        allSuccess = false;
      }
    }
    setSuccess(allSuccess);
  };
  const removePerson = (idx) => {
    setPersons(persons.filter((_, i) => i !== idx));
  };

  // Helper to reset all form fields
  const resetForm = () => {
    setPersons([{ name: "", essen: "", dabei: null }]);
    setEmail("");
    setDabei(null);
    setAnreise([]);
    setEssenFr(false);
    setEssenSa(false);
    setEssenSo(false);
    setUnterkunft("");
    setEssenMitbringsel("");
  };

  return (
    <section>
      <h2>Deine Rückmeldung</h2>
      <form onSubmit={handleSubmit}>
        {/* 1. Name & weitere Personen */}
        <fieldset>
          <legend>Personen</legend>
          {persons.map((person, idx) => (
            <div key={idx}>
              {idx > 0 && <hr style={{ margin: "1rem 0", border: "none", borderTop: "1px solid #ccc" }} />}
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginBottom: "1rem" }}>
                <label_textbox>
                  Name:
                  <input
                    type="text"
                    name={`person_name_${idx}`}
                    value={person.name}
                    onChange={e => handlePersonChange(idx, "name", e.target.value)}
                    required={idx === 0}
                  />
                </label_textbox>
                <label_textbox>
                  Essenswunsch:
                  <select
                    name={`person_essen_${idx}`}
                    value={person.essen}
                    onChange={e => handlePersonChange(idx, "essen", e.target.value)}
                    required
                  >
                    <option value="">Bitte wählen</option>
                    <option value="Vegan">Vegan</option>
                    <option value="Vegetarisch">Vegetarisch</option>
                    <option value="Egal">Egal</option>
                  </select>
                </label_textbox>
                Ist diese Person dabei?
                <label className="horizontal-label">
                  <input
                    type="radio"
                    name={`person_dabei_${idx}`}
                    value="ja"
                    checked={person.dabei === "ja"}
                    onChange={e => handlePersonChange(idx, "dabei", e.target.value)}
                  /> Ja
                </label>
                <label className="horizontal-label">
                  <input
                    type="radio"
                    name={`person_dabei_${idx}`}
                    value="nein"
                    checked={person.dabei === "nein"}
                    onChange={e => handlePersonChange(idx, "dabei", e.target.value)}
                  /> Nein
                </label>
                {idx > 0 && (
                  <button type="button" onClick={() => removePerson(idx)} className="remove-person-btn">Entfernen</button>
                )}
              </div>
            </div>
          ))}
          <button type="button" onClick={addPerson} className="add-person-btn">Weitere Person hinzufügen</button>
        </fieldset>
        <label_textbox>
          Email-Adresse:
          <input
            type="email"
            name="email"
            required
            value={email}
            onChange={e => setEmail(e.target.value)}
          />
        </label_textbox>

        {/* Die Zusage/Absage ist jetzt pro Person und wurde oben integriert */}


        {/* 3. Anreise */}
        <fieldset>
          <legend>Anreise</legend>
          <p>Wann kommt ihr an?</p>
          <label className="horizontal-label">
            <input
              type="radio"
              name="anreise"
              value="freitag"
              checked={anreise === "freitag"}
              onChange={e => setAnreise(e.target.value)}
            />
            Freitag
          </label>
          <label className="horizontal-label">
            <input
              type="radio"
              name="anreise"
              value="samstag"
              checked={anreise === "samstag"}
              onChange={e => setAnreise(e.target.value)}
            />
            Samstag
          </label>

          <p>Verpflegung:</p>
          <label className="horizontal-label">
            <input
              type="checkbox"
              name="essen_freitag"
              value="freitag_abend"
              checked={essen_fr}
              onChange={e => setEssenFr(e.target.checked)}
            />
            Freitag Abendessen
          </label>
          <label className="horizontal-label">
            <input
              type="checkbox"
              name="essen_samstag"
              value="samstag_frühstück"
              checked={essen_sa}
              onChange={e => setEssenSa(e.target.checked)}
            />
            Samstag Frühstück
          </label>
          <label className="horizontal-label">
            <input
              type="checkbox"
              name="essen_sonntag"
              value="sonntag_frühstück"
              checked={essen_so}
              onChange={e => setEssenSo(e.target.checked)}
            />
            Sonntag Frühstück
          </label>
        </fieldset>

        {/* 4. Übernachtung */}
        <fieldset>
          <legend>Übernachtung</legend>
          <p>Bitte wähle:</p>
          <label className="horizontal-label">
            <input
              type="radio"
              name="schlafplatz"
              value="hotel"
              checked={unterkunft === "hotel"}
              onChange={e => setUnterkunft(e.target.value)}
            /> Hotel
          </label>
          <label className="horizontal-label">
            <input
              type="radio"
              name="schlafplatz"
              value="vor_ort"
              checked={unterkunft === "vor_ort"}
              onChange={e => setUnterkunft(e.target.value)}
            /> Zimmer vor Ort
          </label>
          <label className="horizontal-label">
            <input
              type="radio"
              name="schlafplatz"
              value="camping"
              checked={unterkunft === "camping"}
              onChange={e => setUnterkunft(e.target.value)}
            /> Camping/Bulli/Wohnwagen
          </label>
        </fieldset>

        {/* 5. Mitbringen für Frühstück */}
        <fieldset>
          <legend>Frühstück</legend>
          <p>
            Wir kümmern uns um Brötchen und Butter und würden uns freuen, wenn jeder eine Kleinigkeit mitbringen würde.
          </p>
          <p>Einige Ideen: Obst-Sticks, Gemüse-Sticks, Käsewürfel, Aufschnitt, Aufstriche , Bätterteig-Sticks, Pizzaschnecken, Tomate-Mozzarella-Sticks, Muffins (Herzhaft oder Süß).</p>
          <input
            type="text"
            name="fruehstueck"
            placeholder="Was möchtest du mitbringen?"
            value={essen_mitbringsel}
            onChange={e => setEssenMitbringsel(e.target.value)}
          />
        </fieldset>

        <button type="submit">Absenden</button>
      </form>
      {success && (
        <div style={{
          position: "fixed",
          top: 0,
          left: 0,
          width: "100vw",
          height: "100vh",
          background: "rgba(0,0,0,0.5)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 1000
        }}>
          <div style={{
            background: "#fff",
            padding: "2rem",
            borderRadius: "8px",
            boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
            textAlign: "center"
          }}>
            <h3>Vielen Dank für deine Rückmeldung!</h3>
            <p>Deine Daten wurden erfolgreich gespeichert.</p>
            <button onClick={() => { setSuccess(false); resetForm(); }} style={{marginTop: "1rem"}}>Schließen</button>
          </div>
        </div>
      )}
    </section>
  );
}

export default RSVPForm;