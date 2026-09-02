# Tenant Email Template System — Integration Plan

Closes #969

## Problem
`tenantEmailTemplates.routes.ts` and `email-i18n.service.ts` exist but tenant-specific
email templates are not applied during email sends. All tenants receive the default
template regardless of branding configuration stored in the `tenants` table.

## Proposed Changes

### `src/services/email.service.ts`
- Add optional `tenantId` parameter to `EmailRequest`
- In `renderContent()`: when `tenantId` is present, call
  `TenantService.hasFeature(tenant, 'custom_email_templates')` before loading overrides
- If feature enabled, call `TenantEmailTemplatesModel.get(tenantId, templateId)` and
  use the tenant template instead of the default
- Fall back to default `NotificationTemplatesModel` template when no override exists

### `src/services/template-engine.service.ts`
- `resolveTemplate(name, tenantId)` already queries the tenant table; ensure it is
  called from the email send path

### `src/routes/tenantEmailTemplates.routes.ts`
- Preview endpoint (`POST /:name/preview`) already delegates to
  `TemplateEngineService.renderEmail()` via the controller — no change required

## Files to Change
- `src/services/email.service.ts`
- `src/services/template-engine.service.ts` (minor wiring)
