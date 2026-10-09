import { describe, expect, it } from "vitest";
import { myPartstat, parseIcs, zonedToIso } from "./ics.js";

const ICS = [
  "BEGIN:VCALENDAR", "PRODID:-//Google Inc//Google Calendar 70.9054//EN", "VERSION:2.0", "METHOD:REQUEST",
  "BEGIN:VEVENT",
  "DTSTART;TZID=Europe/Berlin:20261023T200000", "DTEND;TZID=Europe/Berlin:20261023T230000",
  "DTSTAMP:20260921T182610Z",
  "ORGANIZER;CN=Pau Soler:mailto:pau.soler@example.net",
  "UID:abc123@google.com",
  "ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE", " ;CN=alex.martin@example.com;X-NUM-GUESTS=0:mailto:alex.martin@example.com",
  "ATTENDEE;PARTSTAT=ACCEPTED;CN=Pau Soler:mailto:pau.soler@example.net",
  "DESCRIPTION:Cena con amigos\\, tráete algo\\nA las 20h",
  "LOCATION:Google Meet",
  "SEQUENCE:0", "STATUS:CONFIRMED",
  "SUMMARY:Cena Pau & friends",
  "END:VEVENT", "END:VCALENDAR",
].join("\r\n");

describe("invitation iCalendar", () => {
  it("lit méthode, titre, dates avec fuseau, organisateur et participants", () => {
    const inv = parseIcs(ICS, "Europe/Madrid")!;
    expect(inv.method).toBe("REQUEST");
    expect(inv.uid).toBe("abc123@google.com");
    expect(inv.summary).toBe("Cena Pau & friends");
    expect(inv.start).toBe("2026-10-23T20:00:00+02:00");
    expect(inv.end).toBe("2026-10-23T23:00:00+02:00");
    expect(inv.allDay).toBe(false);
    expect(inv.location).toBe("Google Meet");
    expect(inv.description).toBe("Cena con amigos, tráete algo\nA las 20h");
    expect(inv.organizer).toEqual({ email: "pau.soler@example.net", name: "Pau Soler" });
    expect(inv.attendees).toHaveLength(2);
    expect(myPartstat(inv, ["Alex.Martin@Example.com"])).toBe("NEEDS-ACTION");
  });
  it("gère la journée entière et l'heure UTC", () => {
    const inv = parseIcs("BEGIN:VCALENDAR\nMETHOD:REQUEST\nBEGIN:VEVENT\nUID:u\nDTSTART;VALUE=DATE:20261101\nDTEND;VALUE=DATE:20261102\nSUMMARY:Toussaint\nEND:VEVENT\nEND:VCALENDAR")!;
    expect(inv.allDay).toBe(true); expect(inv.start).toBe("2026-11-01"); expect(inv.end).toBe("2026-11-01");
    const utc = parseIcs("BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:u\nDTSTART:20261023T180000Z\nEND:VEVENT\nEND:VCALENDAR")!;
    expect(utc.start).toBe("2026-10-23T18:00:00.000Z"); expect(utc.method).toBe("PUBLISH");
  });
  it("journée entière sans DTEND, et sur plusieurs jours : fin = dernier jour inclus", () => {
    expect(parseIcs("BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:u\nDTSTART;VALUE=DATE:20261101\nEND:VEVENT\nEND:VCALENDAR")!.end).toBe("2026-11-01");
    expect(parseIcs("BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:u\nDTSTART;VALUE=DATE:20261230\nDTEND;VALUE=DATE:20270102\nEND:VEVENT\nEND:VCALENDAR")!.end).toBe("2027-01-01");
  });
  it("comprend les fuseaux Windows d'Outlook et retombe sur le fuseau par défaut", () => {
    const outlook = parseIcs("BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:u\nDTSTART;TZID=Romance Standard Time:20261023T200000\nEND:VEVENT\nEND:VCALENDAR", "UTC")!;
    expect(outlook.start).toBe("2026-10-23T20:00:00+02:00");
    const unknown = parseIcs("BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:u\nDTSTART;TZID=Zone inventée:20261223T200000\nEND:VEVENT\nEND:VCALENDAR", "Europe/Madrid")!;
    expect(unknown.start).toBe("2026-12-23T20:00:00+01:00");
  });
  it("renvoie null sans VEVENT", () => expect(parseIcs("BEGIN:VCALENDAR\nEND:VCALENDAR")).toBeNull());
  it("convertit une heure locale en ISO avec décalage, hiver et été", () => {
    expect(zonedToIso("20261023T200000", "Europe/Madrid")).toBe("2026-10-23T20:00:00+02:00");
    expect(zonedToIso("20261223T200000", "Europe/Madrid")).toBe("2026-12-23T20:00:00+01:00");
  });
});
