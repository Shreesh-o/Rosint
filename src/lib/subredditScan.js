import { normalizeUsername } from "../normalizeUsername.js";
import { dynamicallyBlocked as defaultDynamicallyBlocked } from "../blocklist.js";
import { fetchWithBackoff } from "../postLookup.js";
import { getStatus as defaultGetStatus } from "./postMedia.js";

// ─── Archive API Constants ───────────────────────────────────────────────────

export const ARCTIC = "https://arctic-shift.photon-reddit.com";
export const PULLPUSH = "https://api.pullpush.io";
export const LIMIT = 100;
export const INTER_PAGE_DELAY_MS = 250;

// Default sleep helper
export const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ─── Static Blocked Hashes (Mirror of App.jsx) ───────────────────────────────

export const STATIC_BLOCKED_HASHES = Object.freeze([
    "8bd59e71d4a48c92f73d33cfb78ef5a269522357c0588b4b9445d47aaca52405",
    "b8d2f2804ee639cb85854c23f923c62e9885c109de66f38ba54defdfb6e1660c",
    "583be79a3d8aee4309ba3d41d01422159077cc8aae9de40595c1f2831a38f8da",
    "bec537572fbafac5d44dfb065d815ebd4d21861e93587c358e75b0d2ef8dbba6",
    "af73b329e7b4d79252e07829c5a9634d3d48e199a306bff3e6904e9588a29a1e",
    "7d63776df7e0f3f0b2887c712f06c6ef2ec232f24dee686d0af3e0b9664acb89",
    "13cdc20417809368f182116d8003c138f44dbf58f8a8f95fe4b8375613246313",
    "7ffb36a07c0c8505032b119f0db6cc1851dbbfac30f8aefd3702b58d160c9d3f",
    "f677d7f57fd90e759d40372ff796563d240c184be9cf3676c820dd1cf5a17461",
    "7d42355a149b227b525a246d624bdf4351f3059d457095077372a8b64b0609b7",
    "dd3e1d8fc94877e1970764a7075c1616c6bd02f480e7b4c2e63ac4f00364f925",
    "ae27b421885247f764ee8753cf7c3e3a3b1c1963618a27a18683347766255e94",
    "23619d18b6f19ec12fd864c23c4d0ffc1214c25b5a55ec5998ddc6ddeef9df47",
    "93b378a0b8911af4d5395bb88ddcfbc81f76cc6e8c40defabdcc145e2d022c88",
    "040cff49d19c5134ccc4cb1a239e199f188a46c42d5cc3e594f7ca7d003daf2e",
    "17a2b6d95d245f38b387b2e7131af50f39f88943fdec91940038ed4f5f5eb3fb",
    "2a4c3a5844c8689713583c6af2df8f257b9d17e718dfefa060043799e6e45e17",
    "29a1c927cf8f595f9adb6551c6cb633c0bf0024541459f73db99a295e5e99e24",
    "084d1c94a29de378aa8490e420dff45c429a48493eb7a975a70bddcc32003526",
    "79d21778a44478aa491753befc4fd8f170e1e4b66123549481a7f984caa0ce8d",
    "da0d42d0b53e491d1c0acf8480f8d73ac4b264ae6b7cdf08f59bab1afb39dc02",
    "5b90dd4eca41403b8954709c286127f76f6d56aaf235db020ebba53a11fc0132",
    "d8d0d3a78028ae99d6cc5cf98c846332daeb9865fd1d54f3deee135844a67d5d",
    "4ffd5cbb86357bcfae141ac6e4859cdd9985dad3116c22feb30e486ae4d379d2",
    "d336a76c9607e41bc72134037cc1e8818d6548550eb9de32384a6123b50464bd",
    "756552c5903fd2fb88d8cb9f398eb0ec429e6b7e2581455197c82adaf1ded3ec",
    "26653de8bd258a0c348b9b3e3bc92235be6e0a09a1656e5365070f4fc6528889",
    "c23033e8d65daeca5b8878fac380c6a88119140fa9168f63c0940aa2d77a5b6d",
    "736cb54695611602105f36c7ecfa50cc0c2dc203f739679b884657c526568567",
    "3f000e3cb52822a4790325a4e7d1925134238d158ae09129d23aee30e07b1e49",
    "41791bd986b32b7ef22c43687802b23a9b5bcd1cfaff75d37f44806c71bfec44",
    "fff65ed78c51bacf83c6ef0b58bfb4ea387273c8f336b4693d10597dad14034d",
    "8ff9e4dc6fa5ceb7ab4f7bfb31253f63b56fd7fad26f943f383989fe4518dd86",
    "8f596967a0dd7d76d4fe653eeda763d475d0e29734c7d2e70948aeb7cbcca089",
    "8e1bb9c645ad76c3085cff5272f85230acaeb5d47cc2b214c37381abbd42a96a",
    "98a8a752238eef907f9e69bdd2ef8a802d2846b20e0eba85efbd8fe7f7f37f73",
    "92a656b3b5e41de62a21fdc03953d53f9b5698c8a39a7effb2660bb52034c20b",
    "45c4f2d945d857b55363f7d3229e4e6e14a0b61ead60af9aaf7a8a2ede136fe3",
    "2ff45adab30d7c6e0b5690c36498916c35e796365f2b3d8e06297d3f8a647642",
    "436fb7acf92e3fe749226f39452ca2cdb77905cb3c844c30392bb125ecd68572",
    "7dd1634e9c3658f9ba83126298fb6abc3cf80d42c98975e63b0fec1016181d0f",
    "aa1ce5a250dfea9a6a896e4c286f5455f4df4265d231ad1e81b62e58782d4c42",
    "cbb246910799a45592bf6e5c56689eaf4c5f126e0ab15a0d9fe2561828dfbbc8",
    "01028ef25029a0f7980fe4f7913dbd4971fd7f57546cd84d317e30d963f69d88",
    "6b01a248ecd6c229aec29c799f2282841da8d5d0310db0a5178ac2e2cfc59c9f",
    "0606cacac6070843928fee448c74023c497f84fd8fe9792c70928910a4552dc0",
    "c0a520b1a48cee4cbda1c8c6d7a53660f774e20459dc536726a6d37bdd57cb31",
    "68aa629eecb8a4be931a406714d01108e1dc271f36fa4d7a625a6aea051979f9",
    "f1db369cdb945be52691345a150978897a9f51d8f4780be67f8a042860df89f9",
    "eee98ebf4a5a27181cbdfe07fc6e134d6f69f6459458d28cb918791b5dde9b15",
    "148682b6ec13b5a2d7c3af93504940e172ffb9ecd8939852b6e9dcfa75be7ec0",
    "378014fb44e18c9adcad0dc6748bec267ddcd8efa21e48bf2b35b4985b0d3e7f",
    "a8519803b3bd803fe06c7d33e128baab28daf61b8e9272dd9101664528e8cb6e",
    "812a2a2a218e67e29e7953ec64f784f93bf8e3e5b472ec0c3c380ec834bbccef",
    "f791fcc22d559470bc7427ff5003c3583cd8fe423361ce7b6e254b7eb82f2696",
    "60cbf58bbe7db7da0910f2e55eecf0602b08612234429a79731a5b6a6e7bb613",
    "5c8eaa30e52203f4ba1636c4055706afad818d7ec6b7475fdb319cf537ac0e71",
    "2317b657e1713844acfe0195ee45a7af0d7d48dbd1ecfd094603c6dbcd7491f7",
    "209f4cde08a9cbaf362d0304a5589f9bd87944d36f12329e893a0b30a9e054b5",
    "401d71835b22f55c5a52bd7b2a4d9c9cd42c8073ce95b88f80f5f43a723a25f2",
    "8c1fecb83af9aecf17e943b18e3ce12937d99151cbf68dd3eb294c672c24a8ae",
    "1828ae338086c8f8fc5366a7bf86a145fae6e662e7833c597c37873c44ccf757",
    "34066647a7368b2dbf0ec1f1415e0e23ecdc8340fdb9a74d0132e529619e3fa0",
    "e6a0cf39e603716e7a01641afae9930d17225ce18c3e0ce4b9b586dfd045a32c",
    "96f8c79c3d40ecbbf421297eefb3b5e40e0b784a0d84c6ef9b49bcf267c7e0b5",
    "a8706b25aafe5a6d3f25c7980315a0cbb0a26ba33b38a6a68212130325f46401",
    "e0c1f1ec7175402a3a5f27c5bc6bfab4e9f78331f28b2111c1d856096ffc1f6b",
    "5d76d498be58cb5303ca08535a92bf68222956cf9e0789dca31f51052ca5f299",
    "f296312450531bfa2d58544b62fefae3d18e8df6ffbc8296a6d68b9cb526d11e",
    "f1146205ba1b7e4f16b2cf4729f2da5ca14c46f4882dfcaad22a00c735a4d468",
    "6013a771cf49021c3fa36f160473ce4f66ee146f387db2fa2c4bbf37c88b90c3",
    "2e4682ea3fe94f58f01b33db439167e415fb5fa93297379ba0a36928e8f81156",
    "31e21b2d3d927a44f4d2f0eb9670f5e7146b978dff2a7e71c9fe8335ce82d92d",
    "0f8e12d53c7cba7bc12d26fdf2ee56c22d7a2249767ea9a557342672fa998a4d",
    "eb6281696b0ca88849fb753b8908851c1c73ecda4ba3b610c598d975db243b67",
    "bc0a7905f9c5a14c62e519c5b36aa83664fa4c66ef743f55ea252e612808c48a",
    "df89dfc9ea24d27572719ba6bb3a02a7ca79d4791538356c9aebff1c7c88d8b9",
    "850c9535eb0fc6874eb73eb36495b4fe859dd8246e090df4b8735237894a4505",
    "b8c669fb8bc7fc41a7c882bbd5718df8657682d1c6846a36c50ecda3fb49e3bf",
    "0f898a44ecad9efee26a455a40b93d7c588a4ba1289196b0521e1e90ef81816e",
    "64dc34b6b1fcbfa13915f7959074092bba08ba44ff53e8dd2c222ba81ae80ec2",
    "2740529d3161c56cb3c82915832a59a7a933f757f597951d3aa336c19f187a55",
    "ee16a1c5b8b93ea3a72fb36709d7d4c72803b9e4a38779b5c234a9efdf2d0016",
    "5d496013a7c6f082e6669ff8c95c256037f4806a8e8eebf0dd7788448ecbf8cb",
    "aa552df9aa866a4ff5fb605a9ee0ea2fdbb1e428cf4eb76f57e10884b25ea3db",
    "0893049bbd2a71d7986fb878c7fa7cba0d1729007f3ea28eb92652ba7ceca34a",
    "0c1a84f3d2f9ef49045b786c52a36b0fa3f6fc416c117b079633ffc5963ee3d1",
    "8f595cf9573c05b823e5950ee0d828a1c97a5a8fefb0a373fffe8ff0599557f6",
    "e2ea329587fcfd84e493393b3310023ee79669046647fa93040e02c63f1f33c0",
    "033f2c5d15ca2f33f6df287d3dfa56b73ae844b2f6b3cf7381ff074128f7fcb1",
    "d6fb0989e2ce3f6c820612fb05e322efbb6e87f8fbf065798993ebbc0130dbf9",
    "81846b04323b71ca4d1bc9430c6a51d41c8f877caea5715907c1265811776950",
    "35d648f8c44f80879ec2646d5ee3eaae8fb744b7f0f6229977c8657ea1b65679",
    "26e10f1350a417855b77c3e5362ff4e3e6f987f28ae9d7b420061e31d4715f22",
    "01e06e301d0a5146cbbbb52da45df4fe84f70a5c4cc94132ddafccb6d7705fe1",
    "2db5c9ecba5fbc294c65349e54a377b0ecdae9eb3f350ecae8fbe84cc0c5e7b2",
    "858fb3b2ea51d96075c3dbb9ef617a26f63a35ceb0aa447d27e28b84d4ae6e05",
    "fae94d8cb9aa42e0cae25e93340f1cffccbf7df7473a216c8413bcae5c8e31ba",
    "3d666d9c66914bc8b8daefc83d6928cb938e2175dc8e390623a9d701dfc0c003",
    "8fae58dbe559599573886f4a867b1404c449c25fce61bfb49e504c86cb314545",
    "37f26ee2eeaa2049e6f3164a2df856903f0b0dd38e072f85e49bbdf305df6cc6",
    "734dcfc1d9b3ba577884e8ec622a5789a691bc6b75796b34ea6cf7f8db85a213",
    "802a466a2fe0182650ee409f53856b3b29c9261a869aeb897813a444a8fb97a1",
    "485e94b2ba2657e28fc15b13cf05b0bece8c08c4331ea0f9bb4fa7b55f11fc7b",
    "fa980a316c0dd1efadbb7c33116fc8b317c2f0f00f04cbe1f22e8979b940026e",
    "a80f08eeb2957b777a94f69747ba94ddfa2bb45cae7284f29ee87fa07c4bc471",
    "870e28f32230ef17f1a8c0d6e6fe4d34fb68d90ca8da6cfc8efd4faeecf83952",
    "d0473a268a7ba74ff727d2c38848ff7842c676ec8370e4e4e9411dd78a318ea1",
    "71f28b2beaf252b452814838b0e77d012e8736153ea4cbaf6799ae9a3d100067",
    "a3325cfa79eb95e7960fa3bf5c72195dfb478d6b05df8c51ddb8b54b0c20a108",
    "9c750b2aa9ebf1ae137456dff41f0a514d7285a97dd500e2b9f874bc2754d9c4",
    "c81067b5b54659eb4e4b50428d02460d3c0137ce8ce153403d6d0309995536e2",
    "350517926b01b69e46a788878891d4e8c1a6b0c4bf4aa697c170ae08ba45cf6b",
    "4c07c7d42cfcf66a01490212ffea227e8a936a28ff7ea95c32fa1d5ee92aa152",
    "0c9cbbdca5ddca70f44e138b29be3e32b49bcf281a179bf17f0dd3a5e840d02b",
    "e9c402b1ff9e5eb2d0bc7c7689912061244d2d41b65ca4fb65fcbca9c84e9086",
    "fe2189dd1a7333e6188e99879ae097cfba735c024ddf311c97a8ec58d1838944",
    "29633e218206587c69993ea2f640243452ebbe8d7168c4a4f89d38933391d46b",
    "2747192aa7a6e7dd7d363b7ce76e8284ea46261c6b5e1b12b55f1ffb9dbdc6c6",
    "b8c368d40733ebdf1f8875ea0f2ecdd029eef2775fba1845173f2c5e53303350",
    "44d18fa74eb9941961e93892742ea407c81d3923769c0944061a7a13d7890ecb",
    "236e788c0602fba7b165bf2d815e9a4f6bbd49cb00561570bbcf02b96e9526b3",
    "750868f9446d33306913f0c1a96c0ca8ef12ae690db3be7f5c7885b51c4a45a1",
    "da4a0346cbb1593c66f5466826500eb262b95fae2d7870a2f5dd769b7f52ee99",
    "09292dbefc69542cfa5848bb042c07338ba4da50fb27c44ea0cbe0a5fa764aa5",
    "57a26ba3550ba90c23ec9d936e74b3f81fa8ccf618b76c8c4df782bf6b55a80f",
    "dff8753ae298533ef24c82b01da4e9ec691a5332f05fa35ee7b4e9f3b8908ec8",
    "1d6fc29b71f92e4be68bcdd1394b8e21975e536ec6f10bc92b95952f1e6878b7",
    "57fc88a105f25a74577884a44b9cfc0d0c3cb462cb324b1050e68d0bb40cc2ce",
    "c43f721ea7a6c9d5df68dcf0656a59b66a930777fa689e4c5e3153ee612cf747",
    "049d5bf590b11c47dbff25b5978f87e5b6db703117431e7844fb2a688846c4f5",
    "e275531d0ebf084ba7130b925b42d13cae6d2b3815c15ee60bf0034a74288ea7",
    "90b13cf3e387fbf32057393433390c5aa1be0dc964d4d1aa0ae67576f3f03b22",
    "a4362b083329241b711200f46f3328ce78887ee23c7aa310bc908611c3852062",
    "55df27d11f67f25d97f26d7f35bfae1bcdd793bdfaa639207038a8c4c7b2e1bf",
    "73456c66cf640523ec367aa4107849cb1662fb52ff9900c920fca5665b169528",
    "9939eb51b149b563be8d1fc4220b22a014a06511cc84860b73c43734a7d77b49",
    "3579be40fb7299a810b42c67c5e53fa7713d789a7fb3c9b78d227b233a1e944f",
    "26cae752945bb0b8aeef93b45e9a4f4882dfc706fe1a1c93a0bcf5f7fce36a05",
    "1518f8eb01e74f1b5146c9a9d20c5c45e8e895782dd3d2a7f516a51d9eb1b6c0",
    "ce782be12882c9f4d45582f34ee6900f3531b782c5a2781bfaeb0ae6e3fe837b",
    "5701ec0aa0252b944203da0037e28b21ea5c1b6911c79c8cebf00b17135e6c5c",
    "13f283804ce32b00db50b9101f302a0a2df3358dfa7aa150e2ae23d6a26df85c",
    "79ce4114704fb38e6b1856b3e944b0451cf44be1b8a531e285a85ae76d0fffa9",
    "83a6b57956fe6b5417ae41df2aee4eb29ef40f9ddb6bc8fa3910cbe6a896a206",
    "fc8e99ce8b8f22687a41926639c049615e47854e7f363c4cc5bbfd2d8540b616",
    "2bfebc399b19e913a8f4c17cff17849c305dbff286f7b9c970335e396263cb59",
    "c8a0ca0d11c8a8e1df37fce0ba3373eb402cf5846ae65fa7ef1261d710d0a7a0",
    "e974e36569aa13c1c73f3242c2be963065b741005a87b5a8e0344d216f2c0ce6",
    "0f8981df101377484dfce0438ec30113dd88e7b78a9cba271a3640243b9df70f",
    "0c88566b55928d3ef0c746777a82c478a05c7f8a7056dc3b0fe6b1b5e52ae536",
    "4dbe92ecf6fa0a8b444062fb9ae46c8e3170a75f850a58e4e9308ba6e8c89436",
    "503c5452d3a04cfca0e6538a719c218d613e545e85c1387680bb014fc509fa9a",
    "128d54ca5ccb89115d7f1fc357fe7842c381c815ecffb4e2ebbfb46c65cece4b",
    "f29ee87fa07c4bc471aa1ce5a250dfea9a6a896e4c286f5455f4df4265d231ad",
    "3d5c64bf25785a86ebf4ffb415a77ddbe1b9d4c2049e6f3164a2df856903f0b0",
    "7f1190bccecb2fc069a19c5c765ef3dfa19ba113e00e84b8d348a7d1891bca79",
    "c43f50800b691d102e3dc5801ecb0615ef61a7a0068cae2dfce05b95ea26a312",
    "4762c2f4df6d50f8335dbce22d48c89599d1074e50d03fe14c0a158b43171f1e",
    "0bfaf7f8b965f725a3a2283bf36503cba26fc6e0364969ef7956efb96b2be1bf",
    "c8a0cbe0a5fa764aa5781a95c029fa083ec0e3ba6c71c4c81067b5b54659eb4e",
    "0c1a84f3d2f9ef49045b786c52a36b0fa3f6fc416c117b079633ffc5963ee3d1",
    "e275531d0ebf084ba7130b925b42d13cae6d2b3815c15ee60bf0034a74288ea7",
    "f3934fb334559d7d64d4fcfce891665c441509c58e95f5675e4357f1e975488c",
    "9d6f71dc4563fff3a36dec592142e7be4e69ca7102179be6aa176c4caf18b230",
    "bbb9633a1d3e66221476d9a255c80c2f34b22890a90f18c8276847f183233520",
    "002239a9bf1a6ee069e3f3e4d2f83407fc3524f347f186d5e406a155496e30b8",
    "ddaa63b863c841dcd864357336608d0c6ad57a34f81a9f509a376c1428188b97",
    "1544357738b163bf09606374189218a4456dcf428ce607bb065dc1023c589624",
    "573be854301270e271928c3a9b8b82d556f15ee0a2fa041c20bb42d9e124ffda",
    "f85e831663ac188e9e48e177c2e83891ea347fa2296b8169d21ecc8b82cba64c",
    "38ac010bb9d9e17f469d8f0a6b02dba9352846bd4acbae68a33437adac73d6f4",
]);

// ─── Helpers ──────────────────────────────────────────────────────────────────

export async function sha256Hex(text) {
    if (!text || typeof text !== "string") return null;
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function matchesKeywords(item, keywords) {
    if (!keywords || typeof keywords !== "string" || !keywords.trim()) return true;
    const lower = keywords.trim().toLowerCase();
    const titleMatch = Boolean(item?.title && item.title.toLowerCase().includes(lower));
    const selftextMatch = Boolean(item?.selftext && item.selftext.toLowerCase().includes(lower));
    return titleMatch || selftextMatch;
}

// ─── Batch Author Check ───────────────────────────────────────────────────────

/**
 * Checks a list of authors against static hashes and dynamic blocklist.
 * Batched per page: dynamic blocklist is fetched at most once per page.
 * Returns a Set of normalized lowercased authors that are blocked.
 */
export async function checkAuthorsBlocked(authors, {
    blockedHashes = STATIC_BLOCKED_HASHES,
    dynamicallyBlocked: checkDynamic = defaultDynamicallyBlocked,
} = {}) {
    if (!Array.isArray(authors) || authors.length === 0) return new Set();

    // Collect distinct real authors (skip "[deleted]", empty, null)
    const distinct = [...new Set(
        authors
            .map((a) => (typeof a === "string" ? normalizeUsername(a).toLowerCase() : ""))
            .filter((a) => a && a !== "[deleted]")
    )];

    if (distinct.length === 0) return new Set();

    // Hash distinct authors in parallel
    const authorHashes = await Promise.all(
        distinct.map(async (norm) => ({
            norm,
            hash: await sha256Hex(norm),
        }))
    );

    const blockedSet = new Set();
    const needDynamicCheck = [];

    for (const { norm, hash } of authorHashes) {
        if (!hash) continue;
        if (blockedHashes.includes(hash)) {
            blockedSet.add(norm);
        } else {
            needDynamicCheck.push({ norm, hash });
        }
    }

    if (needDynamicCheck.length > 0 && typeof checkDynamic === "function") {
        try {
            // Concurrent checks share the dynamic client's internal promise/cache,
            // resulting in at most 1 network request per batch/reuse window.
            const dynamicResults = await Promise.all(
                needDynamicCheck.map(async ({ norm, hash }) => {
                    try {
                        const blocked = await checkDynamic(hash);
                        return { norm, blocked: Boolean(blocked) };
                    } catch {
                        // Fail-closed: if individual check throws, treat as blocked
                        return { norm, blocked: true };
                    }
                })
            );
            for (const { norm, blocked } of dynamicResults) {
                if (blocked) blockedSet.add(norm);
            }
        } catch {
            // Fail-closed: if the entire dynamic call fails, mark all remaining as blocked
            for (const { norm } of needDynamicCheck) {
                blockedSet.add(norm);
            }
        }
    }

    return blockedSet;
}

// ─── Archive Page Fetching ────────────────────────────────────────────────────

export async function safeFetch(url, { retry = true, onRetry, fetcher } = {}) {
    const res = await fetchWithBackoff(url, {
        init: { headers: { Accept: "application/json" } },
        retries: retry ? undefined : 0,
        fetcher,
        onRetry,
    });
    if (!res) return { data: [], ok: false, status: 0 };
    try {
        const json = await res.json();
        return { data: Array.isArray(json?.data) ? json.data : [], ok: true, status: res.status };
    } catch {
        return { data: [], ok: false, status: res.status };
    }
}

export function buildSubredditUrls({ subreddit, cursor, filters = {} }) {
    const cleanSub = subreddit.replace(/^r\//i, "").trim();
    const base = [
        `limit=${LIMIT}`,
        `sort=desc`,
        `subreddit=${encodeURIComponent(cleanSub)}`,
    ];

    if (filters.over18 != null) {
        base.push(`over_18=${filters.over18}`);
    }

    if (cursor) {
        base.push(`before=${cursor}`);
    } else if (filters.dateTo) {
        base.push(`before=${filters.dateTo}`);
    }

    if (filters.dateFrom) {
        base.push(`after=${filters.dateFrom}`);
    }

    const qs = base.join("&");

    let arcticQs = qs;
    let pullpushQs = qs;
    if (filters.keywords) {
        const kw = encodeURIComponent(filters.keywords.trim());
        arcticQs += `&query=${kw}`;
        pullpushQs += `&q=${kw}`;
    }

    return {
        arctic: `${ARCTIC}/api/posts/search?${arcticQs}`,
        pullpush: `${PULLPUSH}/reddit/search/submission/?test&${pullpushQs}`,
        arcticWithoutKw: `${ARCTIC}/api/posts/search?${qs}`,
        pullpushWithoutKw: `${PULLPUSH}/reddit/search/submission/?test&${qs}`,
    };
}

export async function defaultFetchPage({ subreddit, cursor, filters = {}, fetcher, onRetry } = {}) {
    const urls = buildSubredditUrls({ subreddit, cursor, filters });

    let [arcticRes, pullpushRes] = await Promise.all([
        safeFetch(urls.arctic, { fetcher, onRetry }),
        safeFetch(urls.pullpush, { fetcher, onRetry }),
    ]);

    let keywordFallbackUsed = false;
    // If Arctic Shift failed with keywords (e.g. 422 Unprocessable / timeout on large subs),
    // fall back to fetching Arctic Shift without keywords so client-side filtering can rescue it.
    if (filters.keywords && !arcticRes.ok) {
        const fallbackRes = await safeFetch(urls.arcticWithoutKw, { fetcher, onRetry });
        if (fallbackRes.ok) {
            arcticRes = fallbackRes;
            keywordFallbackUsed = true;
        }
    }

    const seen = new Set();
    const merged = [];
    for (const item of [...arcticRes.data, ...pullpushRes.data]) {
        if (item && item.id && !seen.has(item.id)) {
            seen.add(item.id);
            merged.push(item);
        }
    }

    merged.sort((a, b) => (b.created_utc || 0) - (a.created_utc || 0));

    const ok = arcticRes.ok || pullpushRes.ok;
    return {
        items: merged,
        ok,
        keywordFallbackUsed,
    };
}

// ─── Subreddit Scanner ────────────────────────────────────────────────────────

/**
 * Scans a subreddit for deleted/removed posts across multiple pages.
 * Never accesses or modifies IndexedDB profile cache.
 */
export async function scanSubreddit({
    subreddit,
    filters = {},
    cursor = null,
    maxPages = 5,
    targetCount = 25,
    fetchPage = defaultFetchPage,
    isBlockedAuthor,
    getStatus: customGetStatus = defaultGetStatus,
    sleep = defaultSleep,
    blockedHashes,
    dynamicallyBlocked: customDynamicallyBlocked,
} = {}) {
    // ─── Safety Guard ─────────────────────────────────────────────────────────
    // scanSubreddit must refuse to run unless a working author-block checker
    // is supplied: either isBlockedAuthor, or both a non-empty blockedHashes
    // array and dynamicallyBlocked. There must be no permissive default.
    const hasAuthorChecker = typeof isBlockedAuthor === "function" || (
        Array.isArray(blockedHashes) && blockedHashes.length > 0 && typeof customDynamicallyBlocked === "function"
    );

    if (!hasAuthorChecker) {
        return {
            items: [],
            nextCursor: null,
            scannedCount: 0,
            foundCount: 0,
            exhausted: true,
            errors: ["Working author-block checker required: provide either isBlockedAuthor or both a non-empty blockedHashes array and dynamicallyBlocked"],
        };
    }

    const cleanSubreddit = typeof subreddit === "string" ? subreddit.trim().replace(/^r\//i, "").trim() : "";
    if (!cleanSubreddit || !/^[A-Za-z0-9_]+$/.test(cleanSubreddit)) {
        return {
            items: [],
            nextCursor: null,
            scannedCount: 0,
            foundCount: 0,
            exhausted: true,
            errors: ["Invalid subreddit name. Subreddit names must contain only letters, numbers, and underscores."],
        };
    }
    const items = [];
    const errors = [];
    let scannedCount = 0;
    let nextCursor = cursor;
    let exhausted = false;

    for (let page = 0; page < maxPages; page++) {
        let pageRes;
        try {
            pageRes = await fetchPage({
                subreddit: cleanSubreddit,
                cursor: nextCursor,
                filters,
            });
        } catch (err) {
            errors.push(err.message || String(err));
            break;
        }

        const rawItems = Array.isArray(pageRes) ? pageRes : (pageRes?.items || []);
        const isOk = Array.isArray(pageRes) ? true : Boolean(pageRes?.ok);

        if (!isOk) {
            if (pageRes?.error) {
                errors.push(pageRes.error);
            } else if (pageRes?.errors && Array.isArray(pageRes.errors)) {
                errors.push(...pageRes.errors);
            } else {
                errors.push("Failed to fetch archive page");
            }
            break;
        }

        if (rawItems.length === 0) {
            exhausted = true;
            break;
        }

        // Establish nextCursor from oldest timestamp seen on raw page
        const timestamps = rawItems
            .map((p) => p?.created_utc)
            .filter((t) => typeof t === "number" && !Number.isNaN(t));

        let oldestUtc = null;
        if (timestamps.length > 0) {
            oldestUtc = Math.min(...timestamps);
            nextCursor = oldestUtc;
        }

        // ── Batch Author Blocklist Check ──
        let blockedAuthorSet = new Set();
        if (Array.isArray(blockedHashes) && blockedHashes.length > 0 && typeof customDynamicallyBlocked === "function") {
            // When both are supplied, checkAuthorsBlocked takes precedence because it
            // checks static hashes in memory first and batches all dynamic checks
            // into a single microtick, guaranteeing at most 1 network request per page.
            const rawAuthors = rawItems.map((p) => p?.author);
            blockedAuthorSet = await checkAuthorsBlocked(rawAuthors, {
                blockedHashes,
                dynamicallyBlocked: customDynamicallyBlocked,
            });
        } else if (typeof isBlockedAuthor === "function") {
            const distinct = [...new Set(
                rawItems
                    .map((p) => (typeof p?.author === "string" ? normalizeUsername(p.author).toLowerCase() : ""))
                    .filter((a) => a && a !== "[deleted]")
            )];
            await Promise.all(
                distinct.map(async (author) => {
                    try {
                        const blocked = await isBlockedAuthor(author);
                        if (blocked) blockedAuthorSet.add(author);
                    } catch {
                        // Fail-closed
                        blockedAuthorSet.add(author);
                    }
                })
            );
        }

        // ── Privacy Invariant: Silently Drop Blocked Authors ──
        // Blocked authors are completely dropped before counting or collecting.
        // Author "[deleted]" is kept (no identifiable username).
        const unblockedItems = rawItems.filter((p) => {
            if (!p || typeof p !== "object") return false;
            if (!p.author || p.author === "[deleted]") return true;
            const norm = normalizeUsername(p.author).toLowerCase();
            return !blockedAuthorSet.has(norm);
        });

        // scannedCount reflects strictly unblocked posts examined
        scannedCount += unblockedItems.length;

        // ── Filter Matching Items ──
        for (const post of unblockedItems) {
            // Date filters
            if (filters.dateFrom && typeof post.created_utc === "number" && post.created_utc < filters.dateFrom) {
                continue;
            }
            if (filters.dateTo && typeof post.created_utc === "number" && post.created_utc > filters.dateTo) {
                continue;
            }

            // NSFW filter
            if (filters.over18 != null && post.over_18 !== filters.over18) {
                continue;
            }

            // Keyword filter (client-side fallback & verification)
            if (filters.keywords && !matchesKeywords(post, filters.keywords)) {
                continue;
            }

            // Classification: only removed or deleted posts
            const status = customGetStatus(post, "posts");
            if (status.removed || status.deleted) {
                items.push(post);
                if (items.length >= targetCount) {
                    break;
                }
            }
        }

        // Stop if target reached
        if (items.length >= targetCount) {
            break;
        }

        // Check if dateFrom boundary was passed
        if (filters.dateFrom && oldestUtc !== null && oldestUtc <= filters.dateFrom) {
            exhausted = true;
            break;
        }

        // Delay between pages
        if (page < maxPages - 1) {
            await sleep(INTER_PAGE_DELAY_MS);
        }
    }

    return {
        items,
        nextCursor,
        scannedCount,
        foundCount: items.length,
        exhausted,
        errors,
    };
}
