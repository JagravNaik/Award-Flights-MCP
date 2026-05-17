const PROGRAM_LINKS: Array<{ match: RegExp; name: string; url: string }> = [
  { match: /aeroplan|air canada/i, name: "Air Canada Aeroplan", url: "https://www.aircanada.com/aeroplan/redeem" },
  { match: /united|mileageplus/i, name: "United MileagePlus", url: "https://www.united.com/en/us/book-flight/united-reservations" },
  { match: /lifemiles|avianca/i, name: "Avianca LifeMiles", url: "https://www.lifemiles.com/fly/find" },
  { match: /flying blue|air france|klm/i, name: "Air France-KLM Flying Blue", url: "https://wwws.airfrance.us/search/advanced" },
  { match: /virgin/i, name: "Virgin Atlantic Flying Club", url: "https://www.virginatlantic.com/flight-search/book-a-flight" },
  { match: /alaska|atmos/i, name: "Alaska Airlines Atmos Rewards", url: "https://www.alaskaair.com/search" },
  { match: /american|aadvantage/i, name: "American Airlines AAdvantage", url: "https://www.aa.com/booking/find-flights" },
  { match: /british|avios|executive club/i, name: "British Airways Executive Club", url: "https://www.britishairways.com/travel/redeem/execclub/_gf/en_us" },
  { match: /qantas/i, name: "Qantas Frequent Flyer", url: "https://www.qantas.com/us/en/book-a-trip/flights.html" },
  { match: /emirates/i, name: "Emirates Skywards", url: "https://www.emirates.com/us/english/book/" },
  { match: /singapore|krisflyer/i, name: "Singapore KrisFlyer", url: "https://www.singaporeair.com/en_UK/us/plan-travel/book-flights/" },
  { match: /turkish/i, name: "Turkish Airlines Miles&Smiles", url: "https://www.turkishairlines.com/en-us/flights/booking/" }
];

export function getBookingLinks(input: { origin: string; destination: string; date: string; programs?: string[] }) {
  const programs = input.programs?.length ? input.programs : PROGRAM_LINKS.map((link) => link.name);

  return programs.map((program) => {
    const link = PROGRAM_LINKS.find((candidate) => candidate.match.test(program));
    return {
      program,
      url: link?.url,
      instructions: [
        `Search ${input.origin}-${input.destination} on ${input.date}.`,
        "Use the airline or loyalty program's award/redeem-with-miles option.",
        "Confirm points, taxes, cabin, flight numbers, and passenger count before transferring points."
      ],
      warning: link ? undefined : "No direct booking URL template is configured for this program yet."
    };
  });
}
