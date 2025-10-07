import { motion } from "framer-motion";

export default function InfoSection() {
  return (
    <motion.section
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.6 }}
    >
       <h2>Informationen zur Hochzeit</h2>
      <p>Wir heiraten und freuen uns riesig unseren besonderen Tag mit euch zu feiern!</p>
      <p><strong>Datum:</strong> 09. Mai 2026</p>
      <p><strong>Ort:</strong> Farminn, Kakerbeck 9, 29378 Wittingen </p>
      <p><strong>Ablauf:</strong> Wir laden euch herzlich ein, das ganze Wochenende mit uns im FarmInn zu verbringen.
            Wer mag, kann schon am Freitag, 08. Mai 2026, ab 17 Uhr anreisen – wir starten gemütlich mit einem Beisammensein sowie ein paar Snacks.
            Am Samstag, 09. Mai 2026, beginnen wir mit einem gemeinsamen Frühstück.
            Um ca. 13 Uhr findet unsere Trauung statt, anschließend stoßen wir bei einem Sektempfang an und lassen den Tag bei Abendessen, Musik und Tanz ausklingen.
            Am Sonntag, 10. Mai 2026, möchten wir den Abschluss noch einmal ganz entspannt gestalten und laden euch zu einem weiteren gemeinsamen Frühstück ein.
            Auf dem Gelände befinden sich insgesamt 70 Schlafmöglichkeiten - vor allem in Mehrbettzimmern. Einige wenige Zimmer haben ein eigenes Bad und sonst gibt es 
            große Gemeinschaftsbäder mit einzelnen Duschkabinen (es braucht sich also keiner für das Fertigmachen Sorgen machen). Zusätzlich zu den Zimmern gibt es auch einen Parkplatz auf dem mit Bullis/Womos gecampt werden kann.
            Für die Kommunikation würden wir uns freuen, wenn ihr eine Email-Adresse angebt, damit wir euch wichtige Infos und Updates zukommen lassen können.
        </p>
    </motion.section>
  );
}





