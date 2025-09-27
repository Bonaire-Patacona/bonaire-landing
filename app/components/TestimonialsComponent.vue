<script setup lang="ts">
// copia aquí el teu array de testimonis (o importa'l des d'un composable si ja el tens)
const testimonials = [
  {
    user: {
      name: 'Alejandro',
      description: '5 estrellas · mayo 2025',
      avatar: {
        src: 'https://ui-avatars.com/api/?name=Alejandro',
        loading: 'lazy'
      }
    },
    quote: 'Todo fue como la seda, nos explicó todo perfectamente y nos dio todas las facilidades del mundo, repetiré sin duda!!!'
  },
  {
    user: {
      name: 'Javier',
      description: '5 estrellas · abril 2024',
      avatar: {
        src: 'https://ui-avatars.com/api/?name=Javier',
        loading: 'lazy'
      }
    },
    quote: '¡Ni una sola pega! El piso muy limpio, con todo lo necesario para hacer vida. Bien climatizado, zona tranquila, parking interior y autobús urbano hasta el centro. La playa a 5 minutos. Para guardarlo en favoritos.'
  },
  {
    user: {
      name: 'Marta',
      description: '5 estrellas · junio 2024',
      avatar: {
        src: 'https://ui-avatars.com/api/?name=Marta',
        loading: 'lazy'
      }
    },
    quote: 'Nos ha encantado el apartamento, está a 2 min de la playa andando. La piscina genial y la urbanización muy tranquila. La comunicación con Josep no podría haber sido mejor. Sin duda repetiremos.'
  },
  {
    user: {
      name: 'Lorena',
      description: '5 estrellas · junio 2024',
      avatar: {
        src: 'https://ui-avatars.com/api/?name=Lorena',
        loading: 'lazy'
      }
    },
    quote: 'Hemos pasado unos días maravillosos en este apartamento, con una ubicación inmejorable y muy cerca de Valencia. Urbanización con instalaciones muy buenas y al lado de la playa de la Patacona. Repetiremos sin dudarlo.'
  },
  {
    user: {
      name: 'Marco Antonio',
      description: '5 estrellas · abril 2024',
      avatar: {
        src: 'https://ui-avatars.com/api/?name=Marco+Antonio',
        loading: 'lazy'
      }
    },
    quote: 'La casa y el sitio perfectos, limpia y con todo lo necesario, justo al lado de la playa. Además, Consol estuvo atenta a todas nuestras peticiones. Sin duda volveremos, muy agradecidos.'
  },
  {
    user: {
      name: 'Sultan',
      description: '5 estrellas · noviembre 2024',
      avatar: {
        src: 'https://ui-avatars.com/api/?name=Sultan',
        loading: 'lazy'
      }
    },
    quote: 'Una estancia maravillosa, anfitriones agradables y una casa limpia y acogedora. Me encantó quedarme aquí y tratar con ellos. Definitivamente repetiré la visita de nuevo con mi familia.'
  }
]
</script>

<template>
  <section class="w-full">
    <div class="w-full overflow-hidden">
      <div class="max-w-5xl mx-auto px-4">
        <UMarquee
          pause-on-hover
          :overlay="false"
          :ui="{ root: 'w-full', content: 'inline-flex gap-4 py-1' }"
        >
          <UPageCard
            v-for="(testimonial, idx) in testimonials"
            :key="`t1-${idx}`"
            variant="subtle"
            :description="testimonial.quote"
            :ui="{ description: 'before:content-[open-quote] after:content-[close-quote] line-clamp-3' }"
            class="w-64 shrink-0"
          >
            <template #footer>
              <UUser
                v-bind="testimonial.user"
                size="xl"
                :ui="{ description: 'line-clamp-1' }"
              />
            </template>
          </UPageCard>
        </UMarquee>
      </div>
    </div>

    <!-- segona fila (inversa) -->
    <div class="w-full overflow-hidden mt-6">
      <div class="max-w-5xl mx-auto px-4">
        <UMarquee
          pause-on-hover
          reverse
          :overlay="false"
          :ui="{ root: 'w-full', content: 'inline-flex gap-4 py-1' }"
        >
          <UPageCard
            v-for="(testimonial, idx) in testimonials"
            :key="`t2-${idx}`"
            variant="subtle"
            :description="testimonial.quote"
            :ui="{ description: 'before:content-[open-quote] after:content-[close-quote] line-clamp-3' }"
            class="w-64 shrink-0"
          >
            <template #footer>
              <UUser
                v-bind="testimonial.user"
                size="xl"
                :ui="{ description: 'line-clamp-1' }"
              />
            </template>
          </UPageCard>
        </UMarquee>
      </div>
    </div>
  </section>
</template>

<style scoped>
/* opcional: petites fixes visuals */
.text-muted-foreground {
  color: #6b7280;
}
</style>
