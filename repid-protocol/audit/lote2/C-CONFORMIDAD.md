# Lote 2 — Matriz de conformidad (C)

> Parte del entregable C de la auditoría RepID. Traza cada requisito nuevo (o
> reescrito) declarado por los diffs del lote 2 (`audit/lote2/B-diffs/*.diff`,
> entregable B, sin aplicar) hacia la evidencia de conformidad que debe probarlo.
>
> Convenciones: `[Leído]`=citado textualmente de los diffs, `spec/` o
> `protocol/requirements.json`; `[Inferido]`=deducido del diseño; `[Aplicado]`=
> el diff está en el working tree. La columna `Estado` es el contrato: qué
> test/vector cubre cada RF. Con _Constitution_ Artículo 3, cada RF necesita un
> test real; la columna nombra la evidencia y el §10 registra qué se ejecutó.
>
> Generada contra el estado `0.3.0` de `repid-protocol` (working tree intacto);
> tras la tarea E (2026-10-07) el working tree está en `0.4.0` y los diffs del B
> están **aplicados** (ver §10). Los requisitos se comparan contra
> `protocol/requirements.json` (178 → **216**).

---

## 1. Resumen ejecutivo

| Métrica | Valor |
|---|---|
| Diffs del entregable B | 11 (`SPEC-003`, `SPEC-004`, `SPEC-005`, `SPEC-008`, `SPEC-009`, `SPEC-010`, `WHITE-PAPER`, `constants`, `schema`, `identity_vault`, `covenant-bytecode`) |
| RF **nuevos** declarados en los diffs | **38** (37 + `SPEC-009/RF-W71`, añadido en la revisión; ver §8.2) |
| RF **reescritos** (traceabilidad, sin cambiar el count) | **10** (`SPEC-004` RF-01..05; `SPEC-008` RF-E05/O10/O19; `SPEC-009` RF-W19/W40) |
| `requirements.json` tras regenerar | 178 → **216** |
| Documentos sin RF nuevos | `WHITE-PAPER` (G1–G8), `SPEC-010` (ocho hechos), `constants`, `schema`, `covenant-bytecode` (derivados/artefactos, ver §5) |
| Estado global | **EJECUTADO (E, 2026-10-07)** — vectores y VM corridos, bump a `0.4.0`, demo alineada; ver §10 |
| Vectores normativos de referencia | `SPEC-009` Annex B.3 (14 vectores; `0.4.0`) |

Tipos de conformidad usados en las matrices:
- **C** — Covenant / Bitcoin VM: compilar con `cashc 0.13.2` y ejecutar contra la
  VM real (los mocks no ejecutan el VM, finding existente; la evidencia real-VM
  vive en los E2E de Chipnet, `scripts/chipnet-vault-e2e.mjs`).
- **R** — Reconocimiento de hecho (indexer/SDK): `tx` → hecho estructurado.
- **W** — Wire-format: parsing del contenedor `OP_RETURN` (`SPEC-009` §4.1–4.6).
- **S** — Schema/constantes: `repid-fact.schema.json` / `protocol/constants.json`.
- **I** — Interpretación off-chain (Ledger/reputación, servidor demo); no
  vinculante del protocolo, pero sí exigible como test.

Fuente de verdad de los vectores: `SPEC-009` Annex B.3 ("0.4.0 vectors
(executed by conformance task E)"), cuyas 14 filas se citan en §3.5 y se ejecutan
como `repid-sdk/test/b3_0_4_0_vectors.test.ts` (18 tests).

---

## 2. Matriz **SPEC-003** (recibo: contexto en el commitment y frontera semántica)

| Requisito | Kind | Regla (resumen) | Tipo | Evidencia esperada (tarea E) | Estado |
|---|---|---|---|---|---|
| `SPEC-003/RF-08` | Ubiquity | Contexto opcional en el commitment del recibo: forma `0x10 · cat · roleA · roleB` (4 B) o `0x11 · cat · roleA · roleB · contextHash` (36 B); vacío = legado; roles ligados a las dos partes; sin ids de app/precios/texto (RF-05) | C+R | Vector B.3: commitment de 4 y 36 B → `RECEIPT_GENESIS.receiptContext` con bytes crudos (W73/E11/V15). Covenant: comprobar que `receipt_genesis.cash` no restringe los bytes del commitment de output 0; si lo restringe, es trabajo de covenant | No ejecutado |
| `SPEC-003/RF-09` | Ubiquity | El recibo prueba acuerdo de interacción, no ocurrencia; la ocurrencia la corrobora `PLATFORM_CONFIRMATION`; "recibo sin rating" = señal de interpretación, no hecho | I | Test del servidor (`app.js`/`reputation.mjs`): un `RECEIPT_GENESIS` aislado no produce `RATING_ISSUED` y la vista Reputación lo trata como señal sin peso, no como hecho | No ejecutado |
| `SPEC-003/RF-10` | Undesired Behavior | Auto-corroboración: si la `pkh` que confirma es `partyA` o `partyB` del recibo, la confirmación es inválida | R | Vector B.3 fila 9: `platformPkh` ∈ {partyA, partyB} → `PLATFORM_CONFIRMATION` `valid:false` (restatements en RF-26/O829/S06/V17). Test de clave distinta del recibo → sigue `valid:true` | No ejecutado |

## 3. Matriz **SPEC-004** (vault de rating, `commentHash` y retracción)

| Requisito | Kind | Regla (resumen) | Tipo | Evidencia esperada | Estado |
|---|---|---|---|---|---|
| `SPEC-004/RF-01` (re.) | Ubiquity | Rating Right = `RatingRightVault` single-use con `pkh` del holder (O822); intransferible/no re-emitido | C | Tests 0.3.0 de `rating_right.cash` (sin cambio en B) — **re-verificar** en E | Existente 0.3.0 — re-check |
| `SPEC-004/RF-02` (re.) | Events | Score 1–5 (`REPID_RATING1`, opcionalmente `REPID_RATING2` con `commentHash`) | W+R | Vec. W19 (rango) + B.3 fila 1 (RATING2 válido) | New vector pendiente |
| `SPEC-004/RF-03` (re.) | Ubiquity | El único camino de gasto quema el NFT (O823); una sola rating por participante | C | Tests 0.3.0 `rating_right` spend — re-check | Existente 0.3.0 |
| `SPEC-004/RF-04` (re.) | Undesired Behavior | Score fuera de 1–5 → `valid:false` (no silenciado; lo impone el schema) | S+R | Vector score 0/6 → `RATING_ISSUED` `valid:false`; condicional de `repid-fact.schema.json` (RF-04) | Existente 0.3.0 — re-check |
| `SPEC-004/RF-05` (re.) | Ubiquity | Commitment cruzado: el right de A lleva la `pkh` de B y viceversa (O822) | C+R | Tests 0.3.0 (O822) — re-check | Existente 0.3.0 |
| `SPEC-004/RF-06` | Events | Retracción = **hecho independiente** unilateral: gasta su propio P2PKH + `REPID_RETRACT1` (O827) con el txid del recibo; sin consentimiento, sin Rating Right segundo | R | Vector B.3 fila 4 + E10 + V14 | No ejecutado |
| `SPEC-004/RF-07` | Undesired Behavior | Retracción con recibo desconocido / no firmada por el rater / repetida → `valid:false`; el `RATING_ISSUED` original nunca se borra | R | Vectores B.3 filas 6–8 (W68/W69/W70) + E12 + V14 | No ejecutado |
| `SPEC-004/RF-08` | Events | Gasto con `REPID_RATING2` → decodifica score (1–5) + `commentHash` (32 B) en `RATING_ISSUED` | R | Vector B.3 fila 1 + E05 + V16 | No ejecutado |
| `SPEC-004/RF-09` | Ubiquity | Jamás decodificar/storear/juzgar el comentario tras `commentHash`; la fidelidad es off-chain (preimagen `REPID-CMT-V1`) | R+S | Vector: rating2 con comentario → el hecho lleva **solo** `commentHash`; el schema no expone `comment` | No ejecutado |

## 4. Matriz **SPEC-005** (indexer)

| Requisito | Kind | Regla (resumen) | Tipo | Evidencia esperada | Estado |
|---|---|---|---|---|---|
| `SPEC-005/RF-23` | Events | Commitment con contexto → el `RECEIPT_GENESIS` incluye `interactionCategory`/`roleA`/`roleB` (+`contextHash` en 36 B); nunca inventa; valores desconocidos crudos (W73) | R | Vectores B.3 filas 10–11 + E11 + V15 | No ejecutado |
| `SPEC-005/RF-24` | Events | Rating Right gastado con `REPID_RATING2` → `RATING_ISSUED` con score **y** `commentHash`; con `REPID_RATING1`, sin el campo | R | Vector B.3 fila 1 + E05 + V16 | No ejecutado |
| `SPEC-005/RF-25` | Events | P2PKH propio + `REPID_RETRACT1` (txid) → `RATING_RETRACTION` (raterPkh + txid) y añade la referencia al retracted set (RF-27); si no existe o no la firmó → `valid:false` | R | Vector B.3 fila 4 + W66/W67 + E10 + V14 + W72 | No ejecutado |
| `SPEC-005/RF-26` | Undesired Behavior | Confirmador con `pkh` == `partyA`/`partyB` del recibo (auto-corroboración) → `PLATFORM_CONFIRMATION` `valid:false` | R | Vector B.3 fila 9 + O829 + S06 + V17 | No ejecutado |
| `SPEC-005/RF-27` | Ubiquity | El set de referencias retractadas se **retiene** y reconstruye tras restart; cada entrada vale para su rating sin importar hechos posteriores | R | W72 + test de `createJsonFileStore` persistencia/restart (determinismo de la retracción repetida) | No ejecutado |

## 5. Matriz **SPEC-008** (reconocimiento, invariantes, byte-notes)

| Requisito | Kind | Regla (resumen) | Tipo | Evidencia esperada | Estado |
|---|---|---|---|---|---|
| `SPEC-008/RF-E05` (re.) | Events | `RATING_ISSUED` con `spentOutpoint`/`raterPkh`/`rateePkh`/`score`; con `REPID_RATING2` además `commentHash` | R | Vector B.3 fila 1 + V16 | No ejecutado |
| `SPEC-008/RF-E10` | Events | Retracción reconocida → `RATING_RETRACTION` con `raterPkh`, `receiptTxid`, `valid` | R | Vector B.3 fila 4 + W66 + V14 | No ejecutado |
| `SPEC-008/RF-E11` | Events | Recibo con contexto → `RECEIPT_GENESIS.receiptContext` = `{interactionCategory, roleA, roleB, contextHash?}`; `category`/`role` desconocidos crudos | R | Vectores B.3 filas 10–11 + W73 + V15 | No ejecutado |
| `SPEC-008/RF-E12` | Events | Retracción que referencia rating inexistente / no firmada por el gastador / ya retractada → `valid:false` y **no** borra el `RATING_ISSUED` original | R | Vectores B.3 filas 6–8 + V14 | No ejecutado |
| `SPEC-008/RF-O10` (re.) | Ubiquity | Recibo locked a `partyA`; commitment vacío (legado) o 4/36 B; cruce de commitments de Rating Rights | C | Tests 0.3.0 Receipt genesis — re-check + B.3 filas 10–12 | Existente 0.3.0 + nuevos vectores |
| `SPEC-008/RF-O826` | Events | Rating con `REPID_RATING2` → score + `commentHash` (preimagen `REPID-CMT-V1`); NFT destruido igual que con `RATING1` | R+C | Vector B.3 fila 1 + W64 + rating_right spend | No ejecutado |
| `SPEC-008/RF-O827` | Events | Retracción: gasto del P2PKH propio + `OP_RETURN` con `REPID_RETRACT1` + txid (32 B); sin Rating Right (O824 ya lo destruyó) | W | Vector B.3 fila 4 + W66 | No ejecutado |
| `SPEC-008/RF-O828` | Undesired Behavior | Retracción con rating desconocido / no firmada por el rater / repetida → `valid:false`; el original nunca se borra | R | Vectores B.3 filas 6–8 + E12 | No ejecutado |
| `SPEC-008/RF-O829` | Undesired Behavior | Confirmador == `partyA`/`partyB` → `PLATFORM_CONFIRMATION` `valid:false` (auto-corroboración) | R | Vector B.3 fila 9 + RF-26 + S06 + V17 | No ejecutado |
| `SPEC-008/RF-O831` | Ubiquity | El burn de identidad exige `this.age >= MIN_BURN_DELAY_BLOCKS` (144); un top-up re-lockea y resetea el age; por encima del techo del covenant sigue quemable; **no compilado ni ejecutado por la VM en `0.4.0`** | C | Compilar `identity_vault.cash` (cashc 0.13.2) → actualizar bytes en `covenant-bytecode.json` (0.4.0 real); VM real: burn `age<144` rechazado, tras top-up rechazado, `≥144` aceptado (extender `scripts/chipnet-vault-e2e.mjs`) | No ejecutado — bytecode `PENDING` |
| `SPEC-008/RF-O19` (re.) | Ubiquity | Un hecho on-chain no se modifica ni borra; solo new facts (burn no borra el genesis; retracción no borra la rating) | R/I | Interpretación: Ledger guarda `RATING_ISSUED` + `RATING_RETRACTION` coexistentes | Existente 0.3.0 — re-check |
| `SPEC-008/RF-V14` | Events | Byte-note: retracción → hecho con `raterPkh`/`receiptTxid`/`valid` y retención del set (RF-27); repetida → inválida (RF-07) | R | Vectores B.3 filas 4–8 + W72 | No ejecutado |
| `SPEC-008/RF-V15` | Events | Byte-note: contexto → `receiptContext` con valores crudos (RF-23) | R | Vectores B.3 filas 10–11 + W73 | No ejecutado |
| `SPEC-008/RF-V16` | Events | Byte-note: `REPID_RATING2` → `commentHash` en `RATING_ISSUED`; comentario jamás reconocido (RF-09) | R | Vector B.3 fila 1 + W64 | No ejecutado |
| `SPEC-008/RF-V17` | Undesired Behavior | Byte-note: confirmador == parte del recibo → `PLATFORM_CONFIRMATION` inválida (restate de O829/RF-26) | R | Vector B.3 fila 9 | No ejecutado |
| `SPEC-008/RF-S06` | Undesired Behavior | Confirmador == parte → `PLATFORM_CONFIRMATION` inválida (restate) | R | Vector B.3 fila 9 | No ejecutado |
| `SPEC-008/RF-S07` | Undesired Behavior | Retracción inválida (desconocida / no signer / repetida) | R | Vectores B.3 filas 6–8 | No ejecutado |

## 6. Matriz **SPEC-009** (wire-format, retracción y contexto del recibo)

| Requisito | Kind | Regla (resumen) | Tipo | Evidencia esperada (vector B.3) | Estado |
|---|---|---|---|---|---|
| `SPEC-009/RF-W64` | Events | `OP_RETURN` con exactamente 3 chunks y `REPID_RATING2` (segundo chunk de exactamente 32 B como `commentHash`) → resolver por el right y emitir `RATING_ISSUED` con score + `commentHash` | W+R | B.3 fila 1 | No ejecutado |
| `SPEC-009/RF-W65` | Undesired Behavior | Payload `REPID_RATING2` no exactamente `byte[1]+byte[32]` (chunk count o longitudes) → **no fact** (malformado, §4.6) | W | B.3 filas 2–3 | No ejecutado |
| `SPEC-009/RF-W66` | Events | `OP_RETURN` con exactamente 2 chunks y `REPID_RETRACT1`, segundo chunk de exactamente 32 B = `receiptTxid` (display order) → resolver declarante y emitir `RATING_RETRACTION` | W+R | B.3 fila 4 | No ejecutado |
| `SPEC-009/RF-W67` | Undesired Behavior | Payload `REPID_RETRACT1` no exactamente 32 B o distinto de 2 chunks → **no fact** | W | B.3 fila 5 | No ejecutado |
| `SPEC-009/RF-W68` | Undesired Behavior | Referencia no está en el índice de ratings → `RATING_RETRACTION` `valid:false` | R | B.3 fila 6 | No ejecutado |
| `SPEC-009/RF-W69` | Undesired Behavior | `raterPkh` resuelto != rater de la rating referenciada → `valid:false` | R | B.3 fila 7 | No ejecutado |
| `SPEC-009/RF-W70` | Undesired Behavior | Referencia ya en el retracted set → `valid:false`; el original nunca se borra | R | B.3 fila 8 | No ejecutado |
| `SPEC-009/RF-W71` | Undesired Behavior | Si `platformPkh` == `partyA` o `partyB` del recibo referenciado → `PLATFORM_CONFIRMATION` `valid:false` (auto-corroboración; restates RF-10/RF-26/O829/S06/V17) | R | B.3 fila 9: `platformPkh` ∈ {partyA, partyB} → `valid:false`; clave distinta del recibo → `valid:true` | No ejecutado |
| `SPEC-009/RF-W72` | Events | En `RATING_RETRACTION`, el indexer añade la referencia al retracted set y lo persiste | R | B.3 filas 4/8 + W34 + persistencia | No ejecutado |
| `SPEC-009/RF-W73` | Events | Contexto en output 0 — 4 B (`0x10`): decodifica crudo; 36 B (`0x11`): añade `contextHash`; longitudes/formats desconocidos o flags reservados (`0x00`, `0x11`, `0x1f`) → **no fact** | W+R | B.3 filas 10–12 | No ejecutado |
| `SPEC-009/RF-W74` | Events | En `RECEIPT_GENESIS` con contexto (W73), el indexer lo retiene junto al recibo (depende la auto-corroboración RF-W71 y lecturas posteriores) | R | B.3 filas 10–11 + E11 | No ejecutado |
| `SPEC-009/RF-W76` | Ubiquity | Multi-versión del covenant: la versión aplicable de cada vault es un **hecho declarado** (config o versión grabada en el genesis), nunca probar bytecodes (extiende W56 al mismo-covenant) | R | B.3 fila 14: gasto 0.4.0 bajo binding pre-0.4.0 → no fact (declared set) | No ejecutado |

W19/W40 (reescritos): el reconocimiento de rating cubre `RATING1` **y** `RATING2`
(W19), y el commitment de output 0 del recibo es vacío (legado) **o** 4/36 B
(W40) — re-check de la suite 0.3.0 + nuevos vectores B.3.

---

## 7. Requisitos reescritos (sin cambio de count)

| Clave | Spec | Cambio de texto |
|---|---|---|
| `SPEC-004/RF-01..05` | SPEC-004 | Texto 0.4.0: referencia el covenant `RatingRightVault` (O822), `REPID_RATING2` opcional (RF-02), "one rating per participant" vía O823 (RF-03), rango impuesto por el schema (RF-04), commitment cruzado O822 (RF-05). Evidencia: re-verificar la suite 0.3.0 (`rating_right`, issued rating range) |
| `SPEC-008/RF-E05` | SPEC-008 | `RATING_ISSUED` + `commentHash` opcional con `RATING2` — vector B.3 fila 1 |
| `SPEC-008/RF-O10` | SPEC-008 | Commitment del recibo vacío **o** 4/36 B (contexto), cruce de commitments — tests 0.3.0 + vectores B.3 10–12 |
| `SPEC-008/RF-O19` | SPEC-008 | Inserta "retracting a rating does not erase the rating" — re-check mutabilidad |
| `SPEC-009/RF-W19` | SPEC-009 | Resolución del rater cubre `REPID_RATING1` **y** `RATING2` — vector B.3 fila 1 |
| `SPEC-009/RF-W40` | SPEC-009 | Commitment de output 0: vacío (legado) o 4/36 B (`RF-W73`) — vectores B.3 10–12 |

---

## 8. Superficies sin RF declarado y hallazgos de trazabilidad

### 8.1 Refuerzos (derivados, no declaran RF — su conformidad es el check de regeneración)

- `protocol/constants.json` (diff): tags `REPID_RATING2` (13 B) y `REPID_RETRACT1`
  (14 B) en `OP_RETURN_COMMITMENT_TAG_NAMES`; `SCORE=1`, `COMMENT_HASH=32`;
  objeto `receiptCommitment` (formas 4/36 B de `SPEC-003 RF-08`). Conformidad:
  `npm run encoding:check`, `npm run requirements:check`.
- `protocol/schemas/repid-fact.schema.json` (diff): `paragraph` con `byteHex`/
  `hash32`; `receiptContext` (`required: [interactionCategory, roleA, roleB]`,
  `additionalProperties: false`, `contextHash` opcional); octavo hecho y
  `RATING_RETRACTION` con `hasValidityField` (referido también desde constants).
  Conformidad: `conformance/schema.test.mjs` + vectores de schema en E.
- `SPEC-010` (diff) y `WHITE-PAPER.md` (G1–G8): "siete hechos" → **ocho**,
  "three tags" → **five**; normativo en `SPEC-010` §sobre "ocho hechos";
  no declaran RF (el white paper cita RFs del core). Conformidad: `npm run specs:check`.
- `covenant-bytecode.json` (diff): `identityVault` versionado — `versions."0.3.0"`
  con bytes reales (200 B, validado con node) y `versions."0.4.0"` con
  `status: "PENDING"` (placeholder). **Aplicado sin regenerar rompe
  `npm run bytecode:check`** hasta la tarea E. Conformidad: `npm run bytecode:check`.
- `contracts/identity_vault.cash` (diff): bloque de comentario 0.4.0 en `burn()`
  + `require(this.age >= 144)` marcado "NOT compiled or VM-verified yet (task E)".

### 8.2 Hallazgos de trazabilidad

- **G1 — `SPEC-009/RF-W71` referenciado sin declarar → RESUELTO.** El vector
  B.3 fila 9 y la nota §8 (RF-W74) apuntaban a `RF-W71`, pero el diff entregado
  no añadía su línea de declaración. La regla ya existía como `SPEC-003/RF-10`,
  `SPEC-005/RF-26` y `SPEC-008/RF-O829/S06/V17`; faltaba solo el nivel
  wire-format. Tras esta revisión se **regeneró `SPEC-009.diff`** con la
  declaración en §4.3 (`RF-W71`, Undesired Behavior, `valid:false` si
  `platformPkh` ∈ {partyA, partyB}); `applycheck=0`, `restored=True`. El count
  de nuevos va a **38**.
- **G2 — `identityVault.minBurnDelayBlocks` → FALSO POSITIVO, con retoque.** La
  constante **sí está declarada** en el `constants.diff` entregado
  (`"identityVault": { "minBurnDelayBlocks": 144 }`) bajo el mismo nombre que
  referencia `identity_vault.cash`; la sospecha nació de buscar el literal
  `MIN_BURN_DELAY_BLOCKS`. Lo único incoherente era que `SPEC-008/RF-O831`
  nombraba la constante `MIN_BURN_DELAY_BLOCKS`. Se **regeneró `SPEC-008.diff`**
  para que RF-O831 nombre `identityVault.minBurnDelayBlocks` (idéntico al campo
  real): spec, covenant y constants ahora citan el mismo campo.
- **G3 — lote 1 (colisión RF-W35) → VERIFICADO / BLOQUEADO.** La parte
  verificable se ejecutó contra el inventario real (baseline = lote 1 ya
  aplicado, `requirements.json` 178): **no hay colisión alguna**. Los 38 RF
  nuevos del lote 2 (re-verificados tras la regeneración de G1) no existen en el
  baseline; las únicas coincidencias son los 10 RF intencionalmente reescritos
  (§7). La numeración continúa limpia en todas las series — SPEC-003: baseline
  RF-01..07 → nuevos 08..10; SPEC-004: 01..05 reescritos + 06..09; SPEC-005:
  01..13 → 23..27 (RF-22 reservado por el lote 1); SPEC-008: E01..09 → E10..12,
  O01..20+O821..825 → O826..829 y O831, V01..13 → V14..17, S01..05 →
  S06..07; SPEC-009: W01..59 → W64..W76 (W60..W63 reservados por el lote 1,
  W75 sin usar). `RF-W35` (forma del genesis de identidad, §9.1) es pre-existente
  y no lo toca el lote 2. La parte **no verificable**: el documento llamado
  "draft B del lote 1" no existe en este entorno (`audit/` solo contiene `lote2/`;
  sin ramas ni stash; `t/` es un espejo del SPEC-003 baseline). Per Constitution
  Art. 4 y AGENTS §9, **no se reconstruye desde memoria**; se cierra verificando
  lo verificable y se deja constancia del bloqueo hasta localizar ese artefacto.

---

## 9. Delta de `protocol/requirements.json` (regeneración)

Baseline: **178** entradas. Tras aplicar el lote 2 y ejecutar
`npm run requirements:build`, deben añadirse estos **37** (o 38 con G1) keys:

- `SPEC-003/RF-08`, `SPEC-003/RF-09`, `SPEC-003/RF-10`
- `SPEC-004/RF-06`, `SPEC-004/RF-07`, `SPEC-004/RF-08`, `SPEC-004/RF-09`
- `SPEC-005/RF-23`, `SPEC-005/RF-24`, `SPEC-005/RF-25`, `SPEC-005/RF-26`, `SPEC-005/RF-27`
- `SPEC-008/RF-E10`, `SPEC-008/RF-E11`, `SPEC-008/RF-E12`, `SPEC-008/RF-O826`,
  `SPEC-008/RF-O827`, `SPEC-008/RF-O828`, `SPEC-008/RF-O829`, `SPEC-008/RF-O831`,
  `SPEC-008/RF-V14`, `SPEC-008/RF-V15`, `SPEC-008/RF-V16`, `SPEC-008/RF-V17`,
  `SPEC-008/RF-S06`, `SPEC-008/RF-S07`
- `SPEC-009/RF-W64`, `SPEC-009/RF-W65`, `SPEC-009/RF-W66`, `SPEC-009/RF-W67`,
  `SPEC-009/RF-W68`, `SPEC-009/RF-W69`, `SPEC-009/RF-W70`, `SPEC-009/RF-W71`,
  `SPEC-009/RF-W72`, `SPEC-009/RF-W73`, `SPEC-009/RF-W74`, `SPEC-009/RF-W76`

(38 claves → baseline 178 + 38 = 216. El rango `RF-W64`–`RF-W76` sin `W75`.)

Hasta que E o F regeneren, aplicar los diffs rompe `npm run requirements:check`
**y** `npm run bytecode:check` — declarado en `B-diffs/README.md`.

---

## 10. Estado de ejecución y ruta a tareas E/F

- **Ahora (E ejecutada, 2026-10-07):** los vectores B.3 de `SPEC-009` se ejecutan
  como tests del SDK (`test/b3_0_4_0_vectors.test.ts`, 18 tests), cada uno
  enlazado a su `RF-W64`…`RF-W76` en el manifest de trazabilidad; el burn delay
  de `0.4.0` (RF-O831) se compila y se verifica en VM real deducida
  (`conformance/identity-vault-burn-delay.test.mjs`, 6 tests); `protocol-version.json`
  está en `0.4.0` y `schema.test.mjs` lo comprueba. Resultado: SDK **15 files,
  150 tests, 0 failures** (`npm test` desde el repo `repid-sdk`) + protocolo
  **52 tests, 0 failures**; `check:drift` OK tras `sync:protocol`; `npm run typecheck`
  OK. C-CONFORMIDAD ya no es un plan: es el registro de lo corrido (Art. 3).
- **Tarea F (pendiente, demo `RepID 1.2`):** subir el consumidor a `0.4.0`; lo que
  el B-lote dejó SÍ se hizo en E. Recomendado: los diffs ya están aplicados en el
  working tree; NINGÚN diff queda por regenerar.