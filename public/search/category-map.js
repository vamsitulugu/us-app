/**
 * category-map.js
 * ─────────────────────────────────────────────────────────────
 * Single source of truth for every searchable place category.
 * Used by: overpass-service.js (building queries), search-ui.js
 * (rendering chips/icons), search-service.js (routing).
 *
 * Each entry:
 *   label     – human readable name shown in UI
 *   icon      – emoji icon (no external icon fonts needed)
 *   group     – used to cluster categories in filter UI
 *   osm       – array of Overpass tag filters. Each filter is a
 *               raw Overpass tag-query fragment, e.g. '["amenity"="hotel"]'.
 *               Multiple filters = OR'd together (union query).
 *
 * To add a new OSM-supported category: add one entry here.
 * Nothing else needs to change — overpass-service.js reads this
 * map generically.
 *
 * Reference: https://wiki.openstreetmap.org/wiki/Map_features
 * ─────────────────────────────────────────────────────────────
 */
(function (global) {
  const CATEGORY_MAP = {
    hotel:            { label: 'Hotels',            icon: '🏨', group: 'stay',      osm: ['["tourism"="hotel"]', '["tourism"="guest_house"]', '["tourism"="hostel"]'] },
    restaurant:       { label: 'Restaurants',        icon: '🍽️', group: 'food',      osm: ['["amenity"="restaurant"]'] },
    cafe:             { label: 'Cafes',              icon: '☕', group: 'food',      osm: ['["amenity"="cafe"]'] },
    attraction:       { label: 'Attractions',        icon: '🎡', group: 'leisure',   osm: ['["tourism"="attraction"]'] },
    hospital:         { label: 'Hospitals',          icon: '🏥', group: 'health',    osm: ['["amenity"="hospital"]'] },
    pharmacy:         { label: 'Pharmacies',         icon: '💊', group: 'health',    osm: ['["amenity"="pharmacy"]'] },
    atm:              { label: 'ATMs',               icon: '🏧', group: 'money',     osm: ['["amenity"="atm"]'] },
    bank:             { label: 'Banks',               icon: '🏦', group: 'money',     osm: ['["amenity"="bank"]'] },
    fuel:             { label: 'Petrol Stations',    icon: '⛽', group: 'transport', osm: ['["amenity"="fuel"]'] },
    ev_charging:      { label: 'EV Chargers',        icon: '🔌', group: 'transport', osm: ['["amenity"="charging_station"]'] },
    airport:          { label: 'Airports',           icon: '✈️', group: 'transport', osm: ['["aeroway"="aerodrome"]'] },
    train_station:    { label: 'Railway Stations',   icon: '🚆', group: 'transport', osm: ['["railway"="station"]'] },
    bus_station:      { label: 'Bus Stations',       icon: '🚌', group: 'transport', osm: ['["amenity"="bus_station"]', '["highway"="bus_stop"]'] },
    park:             { label: 'Parks',               icon: '🌳', group: 'leisure',   osm: ['["leisure"="park"]'] },
    beach:            { label: 'Beaches',             icon: '🏖️', group: 'nature',    osm: ['["natural"="beach"]'] },
    mountain:         { label: 'Mountains',           icon: '⛰️', group: 'nature',    osm: ['["natural"="peak"]'] },
    waterfall:        { label: 'Waterfalls',          icon: '💦', group: 'nature',    osm: ['["waterway"="waterfall"]'] },
    museum:           { label: 'Museums',             icon: '🏛️', group: 'leisure',   osm: ['["tourism"="museum"]'] },
    mall:             { label: 'Shopping Malls',      icon: '🛍️', group: 'shopping',  osm: ['["shop"="mall"]'] },
    supermarket:      { label: 'Supermarkets',        icon: '🛒', group: 'shopping',  osm: ['["shop"="supermarket"]'] },
    clothing:         { label: 'Clothing Stores',     icon: '👗', group: 'shopping',  osm: ['["shop"="clothes"]'] },
    salon:            { label: 'Salons',              icon: '💇', group: 'personal',  osm: ['["shop"="hairdresser"]', '["shop"="beauty"]'] },
    gym:              { label: 'Gyms',                icon: '🏋️', group: 'personal',  osm: ['["leisure"="fitness_centre"]'] },
    school:           { label: 'Schools',             icon: '🏫', group: 'education', osm: ['["amenity"="school"]'] },
    college:          { label: 'Colleges',            icon: '🎓', group: 'education', osm: ['["amenity"="college"]', '["amenity"="university"]'] },
    government:       { label: 'Government Offices',  icon: '🏛️', group: 'civic',     osm: ['["office"="government"]'] },
    police:           { label: 'Police Stations',     icon: '🚓', group: 'civic',     osm: ['["amenity"="police"]'] },
    post_office:      { label: 'Post Offices',        icon: '📮', group: 'civic',     osm: ['["amenity"="post_office"]'] },
    custom:           { label: 'Custom Search',       icon: '📍', group: 'other',     osm: [] } // free-text, no fixed tag
  };

  /** Ordered list of category ids for rendering filter chips grouped nicely. */
  const CATEGORY_ORDER = Object.keys(CATEGORY_MAP);

  /** Groups, in display order, for building a two-level filter UI. */
  const GROUP_ORDER = ['stay', 'food', 'leisure', 'nature', 'shopping', 'health', 'money', 'transport', 'personal', 'education', 'civic', 'other'];

  /** Returns the category meta, falling back to a generic pin if unknown. */
  function getCategory(id) {
    return CATEGORY_MAP[id] || { label: id, icon: '📍', group: 'other', osm: [] };
  }

  /**
   * Builds a single Overpass QL "union" filter string for a category,
   * e.g. hotel -> '["tourism"="hotel"];["tourism"="guest_house"];...'
   * Consumed by overpass-service.js.
   */
  function overpassFiltersFor(catId) {
    return getCategory(catId).osm;
  }

  global.SearchCategoryMap = {
    CATEGORY_MAP, CATEGORY_ORDER, GROUP_ORDER, getCategory, overpassFiltersFor
  };
})(window);