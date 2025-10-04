import { defineContentConfig, defineCollection, z } from '@nuxt/content'

const commonSchema = z.object({})

export default defineContentConfig({
  collections: {
    // English content collection
    content_en: defineCollection({
      type: 'page',
      source: {
        include: 'en/**',
        prefix: ''
      },
      schema: commonSchema
    }),
    // French content collection
    content_es: defineCollection({
      type: 'page',
      source: {
        include: 'es/**',
        prefix: ''
      },
      schema: commonSchema
    }),
    // Catalan content collection
    content_ca: defineCollection({
      type: 'page',
      source: {
        include: 'ca/**',
        prefix: ''
      },
      schema: commonSchema
    })
  }
})
