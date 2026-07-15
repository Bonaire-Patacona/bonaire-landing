// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: ['@nuxt/eslint', '@nuxt/ui', '@nuxtjs/i18n', '@nuxtjs/sitemap'],

  devtools: {
    enabled: true
  },

  css: ['~/assets/css/main.css'],

  site: {
    url: 'https://bonairepatacona.com',
    name: 'Bonaire Patacona. Apartamentos turísticos en la playa de la Patacona, Valencia'
  },

  ui: {
    theme: {
      colors: [
        'primary',
        'secondary',
        'airbnb',
        'info',
        'success',
        'warning',
        'error'
      ]
    }
  },

  routeRules: {
    '/': { prerender: true }
  },

  compatibilityDate: '2025-01-15',

  nitro: {
    preset: 'static'
  },

  eslint: {
    config: {
      stylistic: {
        commaDangle: 'never',
        braceStyle: '1tbs'
      }
    }
  },

  i18n: {
    strategy: 'prefix_and_default',
    locales: [
      { code: 'en', iso: 'en-US', name: 'English' },
      { code: 'es', iso: 'es-ES', name: 'Español' },
      { code: 'ca', iso: 'ca-ES', name: 'Català' },
      { code: 'fr', iso: 'fr-FR', name: 'Français' },
      { code: 'de', iso: 'de-DE', name: 'Deutsch' },
      { code: 'it', iso: 'it-IT', name: 'Italiano' },
      { code: 'nl', iso: 'nl-NL', name: 'Nederlands' },
      { code: 'sv', iso: 'sv-SE', name: 'Svenska' }
    ],
    defaultLocale: 'es',
    detectBrowserLanguage: {
      useCookie: true,
      cookieKey: 'i18n_redirected',
      redirectOn: 'root' // recommended
    },
    vueI18n: './locales/index.ts' // use a small i18n loader file
  }
})
