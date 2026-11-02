<template>
  <div class="min-h-dvh flex flex-col">
    <header class="flex items-center gap-3 px-4 pt-4">
      <Button variant="ghost" size="icon" @click="goBack" :aria-label="t('common.back')">
        <ArrowLeft class="h-4 w-4" />
      </Button>
      <h1 class="text-lg font-semibold">{{ isEdit ? t('form.editTitle') : t('form.addTitle') }}</h1>
    </header>

    <form novalidate class="flex-1 p-4 flex flex-col overflow-y-auto pb-6" @submit.prevent="handleSubmit">
      <div class="flex-1 flex flex-col justify-center gap-4">
      <Card>
        <CardContent class="flex flex-col gap-4">
          <div class="flex flex-col gap-1.5">
            <Label for="name" class="text-center justify-center">{{ t('form.name') }}</Label>
            <Input id="name" v-model="form.name" :placeholder="t('form.namePlaceholder')" required />
          </div>
          <div class="flex flex-col gap-1.5">
            <Label for="baseUrl" class="text-center justify-center">{{ t('form.url') }}</Label>
            <Input id="baseUrl" v-model="form.baseUrl" type="url" placeholder="http://192.168.1.100:3773" inputmode="url" required />
            <p v-if="urlWarning" class="text-xs text-muted-foreground">{{ urlWarning }}</p>
            <p v-if="urlError" class="text-xs text-destructive">{{ urlError }}</p>
          </div>
        </CardContent>
        <CardFooter class="flex-col items-stretch gap-4">
          <div class="flex items-center gap-2">
            <Switch id="pairing" v-model="form.pairingEnabled" />
            <Label for="pairing">{{ t('form.pairing') }}</Label>
          </div>
          <template v-if="form.pairingEnabled">
            <div class="flex flex-col gap-1.5">
              <div class="flex gap-1 items-center">
                <Input
                  id="pairingToken"
                  :type="showToken ? 'text' : 'password'"
                  v-model="form.pairingToken"
                  :placeholder="t('form.pairingPlaceholder')"
                  class="flex-1"
                />
                <Button v-if="form.pairingToken" type="button" variant="ghost" size="icon" @click="form.pairingToken = ''">&times;</Button>
                <Button type="button" variant="outline" size="xs" @click="showToken = !showToken">{{ showToken ? t('form.hide') : t('form.show') }}</Button>
              </div>
              <p class="text-xs text-muted-foreground">{{ t('form.pairingHint') }}</p>
              <p v-if="tokenError" class="text-xs text-destructive">{{ tokenError }}</p>
            </div>
          </template>
          <div class="flex items-center gap-2">
            <Switch id="isDefault" v-model="form.isDefault" />
            <Label for="isDefault">{{ t('form.default') }}</Label>
          </div>
        </CardFooter>
      </Card>

      <Alert v-if="formError" variant="destructive">
        <AlertDescription>{{ formError }}</AlertDescription>
      </Alert>
      </div>

      <Button type="submit" class="w-full" size="lg" :disabled="saving">
        {{ saving ? t('form.saving') : (isEdit ? t('form.saveChanges') : t('form.addTitle')) }}
      </Button>
    </form>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { ArrowLeft } from '@lucide/vue'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useServerStore } from '@/stores/serverStore'
import { normalizeUrl, validateUrl } from '@/services/t3code/url'
import { parsePairingInput } from '@/services/t3code/pairing'
import type { ServerProfile } from '@/types'
import { useI18n } from '@/i18n'

const router = useRouter()
const route = useRoute()
const serverStore = useServerStore()
const { t } = useI18n()

const isEdit = computed(() => route.path.includes('/edit'))
const profileId = computed(() => route.params.id as string)

const form = ref({
  name: serverStore.profiles.length === 0 ? `Server#1` : '',
  baseUrl: 'http://192.168.1.xxx:3773',
  pairingEnabled: false,
  pairingToken: '',
  isDefault: serverStore.profiles.length === 0,
  allowInsecureHttp: true,
})

const showToken = ref(false)
const saving = ref(false)
const formError = ref('')
const urlError = ref('')
const urlWarning = ref('')
const tokenError = ref('')

function refreshUrlFeedback(): void {
  urlError.value = ''; urlWarning.value = ''
  const result = validateUrl(form.value.baseUrl)
  if (!result.valid) urlError.value = result.error ?? t('form.invalidUrl')
  else if (result.error) urlWarning.value = result.error
}

watch(() => form.value.baseUrl, refreshUrlFeedback)

// Accept either a bare token or a full pairing URL; when a URL is pasted, pull
// the server address out of it too.
watch(() => form.value.pairingToken, () => {
  tokenError.value = ''
  const raw = form.value.pairingToken.trim()
  if (!raw) return
  const parsed = parsePairingInput(raw)
  if (!parsed) {
    tokenError.value = t('form.invalidToken')
    return
  }
  if (parsed.baseUrl) {
    form.value.baseUrl = parsed.baseUrl
    refreshUrlFeedback()
  }
})

onMounted(async () => {
  await serverStore.load()

  if (isEdit.value) {
    const profile = serverStore.profiles.find((p: ServerProfile) => p.id === profileId.value)
    if (profile) {
      form.value.name = profile.name; form.value.baseUrl = profile.baseUrl
      form.value.pairingEnabled = profile.pairingEnabled
      form.value.isDefault = profile.isDefault
      form.value.allowInsecureHttp = profile.allowInsecureHttp
      if (profile.pairingEnabled) {
        const token = await serverStore.getPairingToken(profile.id)
        if (token) form.value.pairingToken = token
      }
    } else { goBack() }
  } else if (serverStore.profiles.length > 0) {
    form.value.name = `Server#${serverStore.profiles.length + 1}`
    form.value.isDefault = false
  }
})

async function handleSubmit(): Promise<void> {
  formError.value = ''
  if (!form.value.name.trim()) { formError.value = t('form.nameRequired'); return }
  const urlResult = validateUrl(form.value.baseUrl)
  if (!urlResult.valid) { formError.value = urlResult.error ?? t('form.invalidUrl'); return }

  const tokenInput = form.value.pairingToken.trim()
  if (form.value.pairingEnabled && tokenInput && !parsePairingInput(tokenInput)) {
    formError.value = t('form.invalidToken'); return
  }

  saving.value = true
  try {
    const data = {
      name: form.value.name.trim(),
      baseUrl: normalizeUrl(form.value.baseUrl),
      pairingEnabled: form.value.pairingEnabled,
      isDefault: form.value.isDefault,
      allowInsecureHttp: form.value.allowInsecureHttp || true,
      lastStatus: 'unknown' as const, lastConnectedAt: null,
    }
    if (isEdit.value) {
      await serverStore.update(profileId.value, data)
      await saveToken(profileId.value)
    } else {
      const profile = await serverStore.add(data)
      await saveToken(profile.id)
    }
    goBack()
  } catch (err: any) { formError.value = err?.message ?? t('form.saveFailed') }
  finally { saving.value = false }
}

async function saveToken(id: string): Promise<void> {
  const token = form.value.pairingToken.trim()
  if (form.value.pairingEnabled && token) {
    await serverStore.setPairingToken(id, parsePairingInput(token)?.token ?? token)
  } else {
    await serverStore.deletePairingToken(id)
  }
}

function goBack(): void { router.push('/servers') }
</script>
