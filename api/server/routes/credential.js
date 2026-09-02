const { Router } = require('express');
const { requireJwtAuth } = require('~/server/middleware');
const {
  listCredentialResources,
  bindMyCredential,
  unbindMyCredential,
  verifyMyCredential,
} = require('~/server/controllers/credential');

const router = Router();

router.use(requireJwtAuth);

/**
 * GET /api/credential/
 * Lists the user's bindable credential resources (skills + MCP servers with
 * userManaged=true, own or ACL-authorized) with binding status. Cipher
 * material is never returned.
 */
router.get('/', listCredentialResources);

/** PUT /api/credential/:resourceType/:resourceName — bind/update my credential */
router.put('/:resourceType/:resourceName', bindMyCredential);

/** DELETE /api/credential/:resourceType/:resourceName — unbind my credential */
router.delete('/:resourceType/:resourceName', unbindMyCredential);

/** POST /api/credential/:resourceType/:resourceName/verify — verify my credential */
router.post('/:resourceType/:resourceName/verify', verifyMyCredential);

module.exports = router;
