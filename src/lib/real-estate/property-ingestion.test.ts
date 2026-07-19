import { describe, expect, it } from 'vitest';
import {
  parseCoordinates,
  mapMlsToProperty,
  mapPropertyFinderToProperty,
  mapBayutToProperty,
} from './property-ingestion';

describe('parseCoordinates', () => {
  it('parses valid numeric coordinates', () => {
    expect(parseCoordinates(25.321, 51.523)).toEqual({ lat: 25.321, lng: 51.523 });
  });

  it('parses valid string coordinates', () => {
    expect(parseCoordinates('25.321', '51.523')).toEqual({ lat: 25.321, lng: 51.523 });
  });

  it('returns null for invalid coordinates', () => {
    expect(parseCoordinates('invalid', null)).toEqual({ lat: null, lng: null });
  });
});

describe('mapMlsToProperty', () => {
  it('correctly maps a raw MLS payload', () => {
    const raw = {
      mlsId: '123456',
      streetAddress: '123 Main St',
      city: 'Seattle',
      state: 'WA',
      zip: '98101',
      listPrice: 750000,
      bedrooms: 3,
      bathrooms: 2.5,
      latitude: '47.6062',
      longitude: '-122.3321',
      remarks: 'Beautiful craftsman home',
      amenities: ['Hardwood', 'Fireplace'],
      status: 'Active Pending',
    };

    const mapped = mapMlsToProperty(raw, 'account-123', 'user-456');

    expect(mapped).toEqual({
      account_id: 'account-123',
      user_id: 'user-456',
      source: 'MLS',
      source_id: '123456',
      address: '123 Main St, Seattle, WA 98101',
      coordinates_lat: 47.6062,
      coordinates_lng: -122.3321,
      price: 750000,
      beds: 3,
      baths: 2.5,
      status: 'Pending',
      features: ['Hardwood', 'Fireplace'],
      description: 'Beautiful craftsman home',
    });
  });
});

describe('mapPropertyFinderToProperty', () => {
  it('correctly maps a raw Property Finder payload', () => {
    const raw = {
      reference: 'PF-999',
      title: 'Luxury Apartment in Pearl',
      location: 'Pearl Qatar, Doha',
      price: 2500000,
      beds: 2,
      baths: 2,
      lat: 25.3721,
      lng: 51.5524,
      description: 'Stunning sea view apartment',
      amenities: ['Pool', 'Gym'],
      propertyStatus: 'Active',
    };

    const mapped = mapPropertyFinderToProperty(raw, 'account-123');

    expect(mapped).toEqual({
      account_id: 'account-123',
      user_id: null,
      source: 'Property Finder',
      source_id: 'PF-999',
      address: 'Pearl Qatar, Doha',
      coordinates_lat: 25.3721,
      coordinates_lng: 51.5524,
      price: 2500000,
      beds: 2,
      baths: 2,
      status: 'Active',
      features: ['Pool', 'Gym'],
      description: 'Stunning sea view apartment',
    });
  });
});

describe('mapBayutToProperty', () => {
  it('correctly maps a raw Bayut payload', () => {
    const raw = {
      bayutId: 'B-777',
      addressName: 'West Bay, Doha',
      rentOrSalePrice: 15000,
      numBeds: 1,
      numBaths: 1,
      geocoordinates: {
        lat: '25.3198',
        lon: '51.5312',
      },
      desc: 'Cozy studio',
      amenitiesList: ['Furnished', 'AC'],
      statusActive: false,
    };

    const mapped = mapBayutToProperty(raw, 'account-123');

    expect(mapped).toEqual({
      account_id: 'account-123',
      user_id: null,
      source: 'Bayut',
      source_id: 'B-777',
      address: 'West Bay, Doha',
      coordinates_lat: 25.3198,
      coordinates_lng: 51.5312,
      price: 15000,
      beds: 1,
      baths: 1,
      status: 'Off-Market',
      features: ['Furnished', 'AC'],
      description: 'Cozy studio',
    });
  });
});
