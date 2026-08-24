import { createHash } from 'node:crypto'

export const PROPERTY_LOCALES = ['en', 'es', 'ca', 'fr', 'de', 'it', 'nl', 'sv'] as const
export type PropertyLocale = typeof PROPERTY_LOCALES[number]

export interface PropertySourceText {
  name: string
  short_description: string
  description: string
  features: Array<{ id: string, name: string, description: string }>
  reviews: Array<{ id: string, quote: string }>
}

export function isPropertyLocale(value: unknown): value is PropertyLocale {
  return typeof value === 'string' && PROPERTY_LOCALES.includes(value as PropertyLocale)
}

export function propertySourceHash(source: PropertySourceText): string {
  return createHash('sha256').update(JSON.stringify(source)).digest('hex')
}

export function translationSchema(locales: PropertyLocale[]) {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      translations: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            locale: { type: 'string', enum: locales },
            name: { type: 'string' },
            short_description: { type: 'string' },
            description: { type: 'string' },
            features: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  id: { type: 'string' },
                  name: { type: 'string' },
                  description: { type: 'string' }
                },
                required: ['id', 'name', 'description']
              }
            },
            reviews: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  id: { type: 'string' },
                  quote: { type: 'string' }
                },
                required: ['id', 'quote']
              }
            }
          },
          required: ['locale', 'name', 'short_description', 'description', 'features', 'reviews']
        }
      }
    },
    required: ['translations']
  }
}
