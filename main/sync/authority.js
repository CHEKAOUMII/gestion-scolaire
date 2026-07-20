'use strict';

const {
    canPush: registryCanPush,
    getAuthorizedTables: registryAuthorizedTables,
    getEntityType: registryEntityType,
    buildWriterAuthority,
    buildEntityTypeRegistry
} = require('./entity-registry');
const { buildDocumentId: buildDocId } = require('../firebase/collections');

/** @deprecated Prefer entity-registry; kept for compatibility. */
const WRITER_AUTHORITY = buildWriterAuthority();

/** @deprecated Prefer entity-registry; kept for compatibility. */
const ENTITY_TYPE_REGISTRY = buildEntityTypeRegistry();

function canPush(tableName, role) {
    return registryCanPush(tableName, role);
}

function getAuthorizedTables(role) {
    return registryAuthorizedTables(role);
}

function buildDocumentId(tableName, rowData) {
    return buildDocId(tableName, rowData);
}

function getEntityType(tableName) {
    return registryEntityType(tableName);
}

module.exports = {
    WRITER_AUTHORITY,
    ENTITY_TYPE_REGISTRY,
    canPush,
    getAuthorizedTables,
    buildDocumentId,
    getEntityType
};
