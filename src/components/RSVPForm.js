import React, { useState } from "react";
import { motion } from "framer-motion";
import { Users, Mail, BedDouble, CalendarHeart, Coffee } from "lucide-react";

function RSVPForm() {
  const [persons, setPersons] = useState([
    { name: "", essen: "", dabei: null },
  ]);
  const [email, setEmail] = useState("");
  const [anreise, setAnreise] = useState("");
  const [essen_fr, setEssenFr] = useState(false);
  const [essen_sa, setEssenSa] = useState(false);
  const [essen_so, setEssenSo] = useState(false);
  const [unterkunft, setUnterkunft] = useState("");
  const [essen_mitbringsel, setEssenMitbringsel] = useState("");
  const [success, setSuccess] = useState(false);

  const handlePersonChange = (idx, field, value) => {
    const updated = persons.map((p, i) =>
      i === idx ? { ...p, [field]: value } : p
    );
    setPersons(updated);
  };

  const addPerson = () => {
    setPersons([...persons, { name: "", essen: "", dabei: null }]);
  };

  const removePerson = (idx) => {
    setPersons(persons.filter((_, i) => i !== idx));
  };

  const resetForm = () => {
    setPersons([{ name: "", essen: "", dabei: null }]);
    setEmail("");
    setAnreise("");
    setEssenFr(false);
    setEssenSa(false);
    setEssenSo(false);
    setUnterkunft("");
    setEssenMitbringsel("");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    const sharedFields = {
      email,
      anreise,
      essen_fr,
      essen_sa,
      essen_so,
      essen_mitbringsel,
      unterkunft,
    };

    // Use environment variable for API URL, fallback to localhost for development
    const apiUrl = process.env.REACT_APP_API_URL || "http://localhost:8000";

    let allSuccess = true;
    for (const person of persons) {
      const guestData = {
        name: person.name,
        essenswunsch: person.essen,
        dabei: person.dabei === "ja",
        ...sharedFields,
      };
      try {
        const res = await fetch(`${apiUrl}/rsvp`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(guestData),
        });
        if (!res.ok) allSuccess = false;
      } catch {
        allSuccess = false;
      }
    }
    setSuccess(allSuccess);
  };

  return (
    <section id="rsvp" className="rsvp-section">
      <motion.h2
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
      >
        <h2>Deine Rückmeldung</h2>
      </motion.h2>

      <form onSubmit={handleSubmit} className="rsvp-form">
        {/* Personen */}
        <fieldset className="form-box">
          <legend>
            <Users className="icon" /> Personen
          </legend>
          {persons.map((person, idx) => (
            <div key={idx} className="person-block">
              <label>
                Name:
                <input
                  type="text"
                  value={person.name}
                  onChange={(e) =>
                    handlePersonChange(idx, "name", e.target.value)
                  }
                  required
                />
              </label>
              <label style={{ marginTop: "0.7rem", display: "block" }}>
                Essenswunsch:
                <select
                  value={person.essen}
                  onChange={(e) =>
                    handlePersonChange(idx, "essen", e.target.value)
                  }
                  required
                >
                  <option value="">Bitte wählen</option>
                  <option value="Vegan">Vegan</option>
                  <option value="Vegetarisch">Vegetarisch</option>
                  <option value="Egal">Egal</option>
                </select>
              </label>

              <div className="radio-group">
                <p className="question">Bist du dabei?</p>
                <label>
                  <input
                    type="radio"
                    name={`person_dabei_${idx}`}
                    value="ja"
                    checked={person.dabei === "ja"}
                    onChange={(e) =>
                      handlePersonChange(idx, "dabei", e.target.value)
                    }
                  />{" "}
                  Ja
                </label>
                <label>
                  <input
                    type="radio"
                    name={`person_dabei_${idx}`}
                    value="nein"
                    checked={person.dabei === "nein"}
                    onChange={(e) =>
                      handlePersonChange(idx, "dabei", e.target.value)
                    }
                  />{" "}
                  Nein
                </label>
              </div>

              {idx > 0 && (
                <button
                  type="button"
                  className="remove-person-btn"
                  onClick={() => removePerson(idx)}
                  style={{ marginTop: "0.8rem" }}
                >
                  Entfernen
                </button>
              )}
            </div>
          ))}
          <button type="button" onClick={addPerson} className="add-person-btn">
            ➕ Weitere Person hinzufügen
          </button>
        </fieldset>

        {/* Email */}
        <fieldset className="form-box">
          <legend>
            <Mail className="icon" /> Kontakt
          </legend>
          <label>
            Email-Adresse:
            <input
              type="email"
              name="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
        </fieldset>

        {/* Anreise */}
        <fieldset className="form-box">
          <legend>
            <CalendarHeart className="icon" /> Anreise
          </legend>
          <p className="question">Wann kommt ihr an?</p>
          <div className="radio-group">
            <label>
              <input
                type="radio"
                name="anreise"
                value="freitag"
                checked={anreise === "freitag"}
                onChange={(e) => setAnreise(e.target.value)}
              />{" "}
              Freitag
            </label>
            <label>
              <input
                type="radio"
                name="anreise"
                value="samstag"
                checked={anreise === "samstag"}
                onChange={(e) => setAnreise(e.target.value)}
              />{" "}
              Samstag
            </label>
          </div>

          <p className="question">Verpflegung:</p>
          <div className="checkbox-group">
            <label>
              <input
                type="checkbox"
                checked={essen_fr}
                onChange={(e) => setEssenFr(e.target.checked)}
              />
              Freitag Abendessen
            </label>
            <label>
              <input
                type="checkbox"
                checked={essen_sa}
                onChange={(e) => setEssenSa(e.target.checked)}
              />
              Samstag Frühstück
            </label>
            <label>
              <input
                type="checkbox"
                checked={essen_so}
                onChange={(e) => setEssenSo(e.target.checked)}
              />
              Sonntag Frühstück
            </label>
          </div>
        </fieldset>

        {/* Unterkunft */}
        <fieldset className="form-box">
          <legend>
            <BedDouble className="icon" /> Übernachtung
          </legend>
          <div className="radio-group">
            <label>
              <input
                type="radio"
                name="schlafplatz"
                value="hotel"
                checked={unterkunft === "hotel"}
                onChange={(e) => setUnterkunft(e.target.value)}
              />{" "}
              Hotel
            </label>
            <label>
              <input
                type="radio"
                name="schlafplatz"
                value="vor_ort"
                checked={unterkunft === "vor_ort"}
                onChange={(e) => setUnterkunft(e.target.value)}
              />{" "}
              Zimmer vor Ort
            </label>
            <label>
              <input
                type="radio"
                name="schlafplatz"
                value="camping"
                checked={unterkunft === "camping"}
                onChange={(e) => setUnterkunft(e.target.value)}
              />{" "}
              Bulli oder Wohnwagen
            </label>
          </div>
        </fieldset>

        <button type="submit" className="submit-btn">
          Absenden
        </button>
      </form>

      {success && (
        <div className="success-overlay">
          <div className="success-box">
            <h3>Vielen Dank für deine Rückmeldung! 💕</h3>
            <p>Deine Daten wurden erfolgreich gespeichert.</p>
            <button
              onClick={() => {
                setSuccess(false);
                resetForm();
              }}
            >
              Schließen
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

export default RSVPForm;
