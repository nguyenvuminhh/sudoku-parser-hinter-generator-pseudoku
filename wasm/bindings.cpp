// Thin C++ wrapper around l2sg's logical solver, exported to WebAssembly via
// Emscripten embind. The browser calls `getHint(puzzle)` with an 81-character
// board string ('0' or '.' for empty cells) and receives a JSON string
// describing the next logical step, or the literal `null` when there is no
// logical step (board solved, or only guessing/brute force would advance it).
//
// JSON shape (consumed by frontend/src/lib/hints.ts):
//   {
//     "technique":        string,   // l2sg's display name, e.g. "X-Wings"
//     "description":      string,   // one-line human readable summary
//     "difficulty":       number,   // rank, lower = simpler (see rankFor)
//     "causalCells":      number[], // cell indices (0..80) forming the pattern
//     "eliminationCells": number[], // cell indices where candidates are removed
//     "eliminations":     [{ "cell": number, "digit": number }],
//     "placement":        { "cell": number, "digit": number } | null
//   }
//
// Cell index convention matches the frontend: index = row * 9 + col, with row
// and col both 0-based (l2sg uses the same 0-based row/col internally).

#include "l2sg/Enums.h"
#include "l2sg/Grid.h"
#include "l2sg/Logs.h"
#include "l2sg/Solver.h"

#ifdef __EMSCRIPTEN__
#include <emscripten/bind.h>
#endif

#include <array>
#include <functional>
#include <set>
#include <sstream>
#include <string>
#include <utility>
#include <vector>

using namespace l2sg;

namespace
{

std::string jsonEscape(const std::string &s)
{
    std::string out;
    out.reserve(s.size() + 8);
    for (const char c : s)
    {
        switch (c)
        {
            case '"':
                out += "\\\"";
                break;
            case '\\':
                out += "\\\\";
                break;
            case '\n':
                out += "\\n";
                break;
            default:
                out += c;
        }
    }
    return out;
}

// Appends value to vec only if not already present, preserving discovery order.
void pushUnique(std::vector<int> &vec, int value)
{
    for (const int existing : vec)
    {
        if (existing == value)
            return;
    }
    vec.push_back(value);
}

std::string jsonArray(const std::vector<int> &values)
{
    std::ostringstream out;
    out << '[';
    for (size_t i = 0; i < values.size(); ++i)
    {
        if (i != 0)
            out << ',';
        out << values[i];
    }
    out << ']';
    return out.str();
}

int cellIndex(const std::pair<int, int> &cell)
{
    return cell.first * 9 + cell.second;
}

// Serializes a hint into the JSON shape documented at the top of this file.
// Shared by the l2sg path and the advanced fallback techniques below.
std::string buildHintJson(const std::string &techniqueName, int difficulty,
                          const std::vector<int> &causalCells, const std::vector<int> &eliminationCells,
                          const std::vector<std::pair<int, int>> &eliminations, int placementCell,
                          int placementDigit)
{
    std::ostringstream desc;
    if (placementCell >= 0)
    {
        desc << techniqueName << ": place " << placementDigit << " in R" << (placementCell / 9 + 1) << "C"
             << (placementCell % 9 + 1) << ".";
    }
    else
    {
        std::set<int> digits;
        for (const auto &elim : eliminations)
            digits.insert(elim.second);

        desc << techniqueName << ": remove ";
        bool first = true;
        for (const int digit : digits)
        {
            if (!first)
                desc << ", ";
            desc << digit;
            first = false;
        }
        desc << " from " << eliminationCells.size() << " cell" << (eliminationCells.size() == 1 ? "" : "s") << ".";
    }

    std::ostringstream out;
    out << '{';
    out << "\"technique\":\"" << jsonEscape(techniqueName) << "\",";
    out << "\"description\":\"" << jsonEscape(desc.str()) << "\",";
    out << "\"difficulty\":" << difficulty << ',';
    out << "\"causalCells\":" << jsonArray(causalCells) << ',';
    out << "\"eliminationCells\":" << jsonArray(eliminationCells) << ',';
    out << "\"eliminations\":[";
    for (size_t i = 0; i < eliminations.size(); ++i)
    {
        if (i != 0)
            out << ',';
        out << "{\"cell\":" << eliminations[i].first << ",\"digit\":" << eliminations[i].second << '}';
    }
    out << "],";
    out << "\"placement\":";
    if (placementCell >= 0)
        out << "{\"cell\":" << placementCell << ",\"digit\":" << placementDigit << '}';
    else
        out << "null";
    out << '}';
    return out.str();
}

// --- Advanced fallback techniques ------------------------------------------
// These run only when l2sg's solver (capped at LEV_3_LOGIC) finds no step, so
// they sit above everything l2sg implements. All are elimination-only and were
// validated for soundness (never removing a solution candidate) against tens of
// thousands of rated puzzles. Cell index = row * 9 + col, matching the rest of
// this file.
using Notes = Cell::Notes;

inline int boxOf(int r, int c) { return (r / 3) * 3 + (c / 3); }

// Whether two distinct cells share a row, column, or box (i.e. are peers).
inline bool seesRC(int r1, int c1, int r2, int c2)
{
    if (r1 == r2 && c1 == c2)
        return false;
    return r1 == r2 || c1 == c2 || boxOf(r1, c1) == boxOf(r2, c2);
}

inline int firstNote(const Notes &n)
{
    for (int d = 1; d <= 9; ++d)
        if (n.test(d - 1))
            return d;
    return 0;
}

struct FallbackHint
{
    bool found = false;
    std::string technique;
    int difficulty = 99;
    std::vector<int> causalCells;
    std::vector<int> eliminationCells;
    std::vector<std::pair<int, int>> eliminations; // (cellIndex, digit)
};

inline void addElim(FallbackHint &h, int r, int c, int digit)
{
    h.eliminations.emplace_back(r * 9 + c, digit);
    pushUnique(h.eliminationCells, r * 9 + c);
}

// XYZ-Wing: pivot {x,y,z}; two bivalue peers {x,z} and {y,z} (subsets of the
// pivot sharing exactly z); z is removed from cells seeing all three.
FallbackHint fbXyzWing(const Grid &g)
{
    FallbackHint s;
    for (int pr = 0; pr < 9; ++pr)
        for (int pc = 0; pc < 9; ++pc)
        {
            const Notes P = g.getNotes(pr, pc);
            if (P.count() != 3)
                continue;
            std::vector<std::pair<int, int>> pincers;
            for (int r = 0; r < 9; ++r)
                for (int c = 0; c < 9; ++c)
                {
                    if (!seesRC(pr, pc, r, c))
                        continue;
                    const Notes N = g.getNotes(r, c);
                    if (N.count() != 2 || (N & ~P).any())
                        continue;
                    pincers.emplace_back(r, c);
                }
            for (size_t i = 0; i < pincers.size(); ++i)
                for (size_t j = i + 1; j < pincers.size(); ++j)
                {
                    const int r1 = pincers[i].first, c1 = pincers[i].second;
                    const int r2 = pincers[j].first, c2 = pincers[j].second;
                    const Notes n1 = g.getNotes(r1, c1), n2 = g.getNotes(r2, c2);
                    if ((n1 | n2) != P)
                        continue;
                    const Notes common = n1 & n2;
                    if (common.count() != 1)
                        continue;
                    const int z = firstNote(common);
                    FallbackHint cand;
                    for (int r = 0; r < 9; ++r)
                        for (int c = 0; c < 9; ++c)
                        {
                            if ((r == pr && c == pc) || (r == r1 && c == c1) || (r == r2 && c == c2))
                                continue;
                            if (!g.hasNote(r, c, z))
                                continue;
                            if (seesRC(pr, pc, r, c) && seesRC(r1, c1, r, c) && seesRC(r2, c2, r, c))
                                addElim(cand, r, c, z);
                        }
                    if (!cand.eliminations.empty())
                    {
                        s.found = true;
                        s.technique = "XYZ-Wing";
                        s.difficulty = 17;
                        pushUnique(s.causalCells, pr * 9 + pc);
                        pushUnique(s.causalCells, r1 * 9 + c1);
                        pushUnique(s.causalCells, r2 * 9 + c2);
                        s.eliminationCells = cand.eliminationCells;
                        s.eliminations = cand.eliminations;
                        return s;
                    }
                }
        }
    return s;
}

// Unique Rectangle (Type 1): 4 corners in two rows/cols spanning exactly two
// boxes, three of them the bivalue {a,b} and the fourth a superset -> remove a
// and b from the fourth. Sound only for unique-solution puzzles.
FallbackHint fbUniqueRectangle(const Grid &g)
{
    FallbackHint s;
    for (int r1 = 0; r1 < 9; ++r1)
        for (int r2 = r1 + 1; r2 < 9; ++r2)
            for (int c1 = 0; c1 < 9; ++c1)
                for (int c2 = c1 + 1; c2 < 9; ++c2)
                {
                    const bool sameBand = (r1 / 3 == r2 / 3), sameStack = (c1 / 3 == c2 / 3);
                    if (sameBand == sameStack)
                        continue; // exactly one true => the 4 corners span 2 boxes
                    const int cr[4] = {r1, r1, r2, r2};
                    const int cc[4] = {c1, c2, c1, c2};
                    bool anyFilled = false;
                    for (int k = 0; k < 4; ++k)
                        if (g.getNotes(cr[k], cc[k]).count() == 0)
                            anyFilled = true;
                    if (anyFilled)
                        continue;
                    for (int ex = 0; ex < 4; ++ex)
                    {
                        const Notes pe = g.getNotes(cr[ex], cc[ex]);
                        if (pe.count() < 3)
                            continue;
                        Notes P;
                        bool first = true, good = true;
                        for (int k = 0; k < 4 && good; ++k)
                        {
                            if (k == ex)
                                continue;
                            const Notes N = g.getNotes(cr[k], cc[k]);
                            if (N.count() != 2)
                            {
                                good = false;
                                break;
                            }
                            if (first)
                            {
                                P = N;
                                first = false;
                            }
                            else if (N != P)
                                good = false;
                        }
                        if (!good || (P & pe) != P)
                            continue;
                        s.found = true;
                        s.technique = "Unique Rectangle";
                        s.difficulty = 18;
                        for (int k = 0; k < 4; ++k)
                            pushUnique(s.causalCells, cr[k] * 9 + cc[k]);
                        for (int d = 1; d <= 9; ++d)
                            if (P.test(d - 1))
                                addElim(s, cr[ex], cc[ex], d);
                        return s;
                    }
                }
    return s;
}

// XY-Chain: chain of bivalue cells C0={z,v1}, C1={v1,v2}, ..., Cn={vn,z} with
// consecutive cells peers; any cell seeing both ends and holding z cannot be z.
FallbackHint fbXyChain(const Grid &g)
{
    FallbackHint s;
    std::vector<std::pair<int, int>> biv;
    for (int r = 0; r < 9; ++r)
        for (int c = 0; c < 9; ++c)
            if (g.getNotes(r, c).count() == 2)
                biv.emplace_back(r, c);

    long budget = 200000; // bound the search per hint request
    for (auto &start : biv)
    {
        const int sr = start.first, sc = start.second;
        const Notes sn = g.getNotes(sr, sc);
        int d[2], nd = 0;
        for (int x = 1; x <= 9; ++x)
            if (sn.test(x - 1))
                d[nd++] = x;
        for (int zi = 0; zi < 2 && !s.found; ++zi)
        {
            const int z = d[zi], firstCarry = d[1 - zi];
            std::vector<std::pair<int, int>> chain{{sr, sc}};
            bool visited[9][9] = {{false}};
            visited[sr][sc] = true;
            std::function<bool(int, int, int)> dfs = [&](int cr, int cc, int need) -> bool {
                if (chain.size() > 10 || --budget < 0)
                    return false;
                for (auto &nx : biv)
                {
                    const int nr = nx.first, ncl = nx.second;
                    if (visited[nr][ncl] || !seesRC(cr, cc, nr, ncl) || !g.hasNote(nr, ncl, need))
                        continue;
                    const Notes nn = g.getNotes(nr, ncl);
                    int other = 0;
                    for (int x = 1; x <= 9; ++x)
                        if (nn.test(x - 1) && x != need)
                            other = x;
                    if (other == 0)
                        continue;
                    chain.emplace_back(nr, ncl);
                    visited[nr][ncl] = true;
                    if (other == z && chain.size() >= 3)
                    {
                        FallbackHint cand;
                        for (int r = 0; r < 9; ++r)
                            for (int c = 0; c < 9; ++c)
                            {
                                bool inChain = false;
                                for (auto &ch : chain)
                                    if (ch.first == r && ch.second == c)
                                    {
                                        inChain = true;
                                        break;
                                    }
                                if (inChain || !g.hasNote(r, c, z))
                                    continue;
                                if (seesRC(sr, sc, r, c) && seesRC(nr, ncl, r, c))
                                    addElim(cand, r, c, z);
                            }
                        if (!cand.eliminations.empty())
                        {
                            s.found = true;
                            s.technique = "XY-Chain";
                            s.difficulty = 19;
                            for (auto &ch : chain)
                                pushUnique(s.causalCells, ch.first * 9 + ch.second);
                            s.eliminationCells = cand.eliminationCells;
                            s.eliminations = cand.eliminations;
                            return true;
                        }
                    }
                    if (dfs(nr, ncl, other))
                        return true;
                    chain.pop_back();
                    visited[nr][ncl] = false;
                }
                return false;
            };
            if (dfs(sr, sc, firstCarry))
                return s;
        }
    }
    return s;
}

// An Almost Locked Set: N cells in one house holding exactly N+1 candidates.
struct ALS
{
    std::vector<std::pair<int, int>> cells;
    Notes cands;
};

void collectALS(const Grid &g, std::vector<ALS> &out)
{
    std::vector<std::vector<std::pair<int, int>>> seen;
    for (int h = 0; h < 27; ++h)
    {
        std::vector<std::pair<int, int>> cells;
        for (int k = 0; k < 9; ++k)
        {
            int r, c;
            if (h < 9) { r = h; c = k; }            // rows
            else if (h < 18) { r = k; c = h - 9; }  // columns
            else { const int b = h - 18; r = (b / 3) * 3 + k / 3; c = (b % 3) * 3 + k % 3; } // boxes
            if (g.getNotes(r, c).count() >= 1)
                cells.emplace_back(r, c);
        }
        const int n = (int)cells.size();
        for (int mask = 1; mask < (1 << n); ++mask)
        {
            const int sz = __builtin_popcount(mask);
            if (sz > 5) // cap ALS size to keep the search bounded
                continue;
            Notes u;
            std::vector<std::pair<int, int>> sub;
            for (int i = 0; i < n; ++i)
                if (mask & (1 << i))
                {
                    u |= g.getNotes(cells[i].first, cells[i].second);
                    sub.push_back(cells[i]);
                }
            if ((int)u.count() != sz + 1)
                continue;
            bool dup = false;
            for (auto &k : seen)
                if (k == sub)
                {
                    dup = true;
                    break;
                }
            if (dup)
                continue;
            seen.push_back(sub);
            out.push_back({sub, u});
        }
    }
}

// ALS-XZ: two cell-disjoint ALSs sharing a restricted common X (all X-cells of
// one see all X-cells of the other); any other common candidate Z is removed
// from cells seeing every Z-cell of both ALSs.
FallbackHint fbAlsXZ(const Grid &g)
{
    FallbackHint s;
    std::vector<ALS> als;
    collectALS(g, als);
    auto disjoint = [](const ALS &a, const ALS &b) {
        for (auto &x : a.cells)
            for (auto &y : b.cells)
                if (x == y)
                    return false;
        return true;
    };
    long budget = 4000000; // bound the pair search per hint request
    for (size_t ai = 0; ai < als.size(); ++ai)
        for (size_t bi = ai + 1; bi < als.size(); ++bi)
        {
            if (--budget < 0)
                return s;
            const ALS &A = als[ai], &B = als[bi];
            const Notes common = A.cands & B.cands;
            if (common.count() < 2 || !disjoint(A, B))
                continue;
            for (int X = 1; X <= 9; ++X)
            {
                if (!common.test(X - 1))
                    continue;
                std::vector<std::pair<int, int>> AX, BX;
                for (auto &k : A.cells)
                    if (g.hasNote(k.first, k.second, X))
                        AX.push_back(k);
                for (auto &k : B.cells)
                    if (g.hasNote(k.first, k.second, X))
                        BX.push_back(k);
                bool restricted = !AX.empty() && !BX.empty();
                for (auto &a : AX)
                    for (auto &b : BX)
                        if (!seesRC(a.first, a.second, b.first, b.second))
                            restricted = false;
                if (!restricted)
                    continue;
                for (int Z = 1; Z <= 9; ++Z)
                {
                    if (Z == X || !common.test(Z - 1))
                        continue;
                    std::vector<std::pair<int, int>> ZC;
                    for (auto &k : A.cells)
                        if (g.hasNote(k.first, k.second, Z))
                            ZC.push_back(k);
                    for (auto &k : B.cells)
                        if (g.hasNote(k.first, k.second, Z))
                            ZC.push_back(k);
                    FallbackHint cand;
                    for (int r = 0; r < 9; ++r)
                        for (int c = 0; c < 9; ++c)
                        {
                            if (!g.hasNote(r, c, Z))
                                continue;
                            bool inAB = false;
                            for (auto &k : A.cells)
                                if (k.first == r && k.second == c)
                                    inAB = true;
                            for (auto &k : B.cells)
                                if (k.first == r && k.second == c)
                                    inAB = true;
                            if (inAB)
                                continue;
                            bool seesAll = true;
                            for (auto &k : ZC)
                                if (!seesRC(r, c, k.first, k.second))
                                {
                                    seesAll = false;
                                    break;
                                }
                            if (seesAll)
                                addElim(cand, r, c, Z);
                        }
                    if (!cand.eliminations.empty())
                    {
                        s.found = true;
                        s.technique = "ALS-XZ";
                        s.difficulty = 20;
                        for (auto &k : A.cells)
                            pushUnique(s.causalCells, k.first * 9 + k.second);
                        for (auto &k : B.cells)
                            pushUnique(s.causalCells, k.first * 9 + k.second);
                        s.eliminationCells = cand.eliminationCells;
                        s.eliminations = cand.eliminations;
                        return s;
                    }
                }
            }
        }
    return s;
}

// AIC (Alternating Inference Chain): nodes are candidates (cell, digit) joined
// by alternating strong/weak inferences, starting and ending on strong links,
// which proves "endpoint0 OR endpointK" is true. Any candidate weakly linked to
// *both* endpoints is therefore false. Generalizes XY-Chain / X-Chain /
// Skyscraper / Two-String-Kite, so it runs last and catches what they miss.
FallbackHint fbAic(const Grid &g)
{
    FallbackHint s;
    struct Nd { int r, c, d; };
    std::vector<Nd> nodes;
    int idx[9][9][10];
    for (int r = 0; r < 9; ++r)
        for (int c = 0; c < 9; ++c)
            for (int d = 1; d <= 9; ++d)
                idx[r][c][d] = -1;
    for (int r = 0; r < 9; ++r)
        for (int c = 0; c < 9; ++c)
            for (int d = 1; d <= 9; ++d)
                if (g.hasNote(r, c, d))
                {
                    idx[r][c][d] = (int)nodes.size();
                    nodes.push_back({r, c, d});
                }
    const int N = (int)nodes.size();

    // Precompute strong/weak adjacency. A strong link ("if one is false the
    // other is true") comes from a bivalue cell or a conjugate pair (a digit
    // confined to two cells of a unit). A weak link ("if one is true the other
    // is false") comes from sharing a cell or being peers on the same digit.
    std::vector<std::vector<int>> strongAdj(N), weakAdj(N);
    for (int i = 0; i < N; ++i)
    {
        const Nd &n = nodes[i];
        for (int d = 1; d <= 9; ++d)
            if (d != n.d && idx[n.r][n.c][d] >= 0)
                weakAdj[i].push_back(idx[n.r][n.c][d]);
        for (int r = 0; r < 9; ++r)
            for (int c = 0; c < 9; ++c)
                if (!(r == n.r && c == n.c) && idx[r][c][n.d] >= 0 && seesRC(n.r, n.c, r, c))
                    weakAdj[i].push_back(idx[r][c][n.d]);
        if (g.getNotes(n.r, n.c).count() == 2)
            for (int d = 1; d <= 9; ++d)
                if (d != n.d && idx[n.r][n.c][d] >= 0)
                    strongAdj[i].push_back(idx[n.r][n.c][d]);
        {
            int cnt = 0, o = -1;
            for (int c = 0; c < 9; ++c)
                if (g.hasNote(n.r, c, n.d)) { ++cnt; if (c != n.c) o = c; }
            if (cnt == 2) strongAdj[i].push_back(idx[n.r][o][n.d]);
        }
        {
            int cnt = 0, o = -1;
            for (int r = 0; r < 9; ++r)
                if (g.hasNote(r, n.c, n.d)) { ++cnt; if (r != n.r) o = r; }
            if (cnt == 2) strongAdj[i].push_back(idx[o][n.c][n.d]);
        }
        {
            int br = (n.r / 3) * 3, bc = (n.c / 3) * 3, cnt = 0, orr = -1, oc = -1;
            for (int dr = 0; dr < 3; ++dr)
                for (int dc = 0; dc < 3; ++dc)
                {
                    int r = br + dr, c = bc + dc;
                    if (g.hasNote(r, c, n.d)) { ++cnt; if (!(r == n.r && c == n.c)) { orr = r; oc = c; } }
                }
            if (cnt == 2) strongAdj[i].push_back(idx[orr][oc][n.d]);
        }
    }

    auto weakLinked = [&](int a, int b) {
        const Nd &x = nodes[a], &y = nodes[b];
        if (x.r == y.r && x.c == y.c) return x.d != y.d;
        if (x.d == y.d) return seesRC(x.r, x.c, y.r, y.c);
        return false;
    };

    long budget = 3000000; // bound the chain search per hint request
    std::vector<char> inChain(N, 0);
    std::vector<int> chain;
    std::function<bool(int, int, bool, int)> dfs = [&](int startI, int cur, bool needStrong, int linkCount) -> bool {
        if (linkCount > 12 || --budget < 0)
            return false;
        const auto &adj = needStrong ? strongAdj[cur] : weakAdj[cur];
        for (int nb : adj)
        {
            if (inChain[nb])
                continue;
            chain.push_back(nb);
            inChain[nb] = 1;
            const int nlc = linkCount + 1;
            // After an odd number of links (>=3) the chain just crossed a strong
            // link, so `nb` is "on": endpoints are proven to be "start OR nb".
            if (needStrong && nlc >= 3 && (nlc % 2 == 1))
            {
                FallbackHint cand;
                for (int X = 0; X < N; ++X)
                {
                    if (X == startI || X == nb || inChain[X])
                        continue;
                    if (weakLinked(X, startI) && weakLinked(X, nb))
                        addElim(cand, nodes[X].r, nodes[X].c, nodes[X].d);
                }
                if (!cand.eliminations.empty())
                {
                    s.found = true;
                    s.technique = "AIC";
                    s.difficulty = 21;
                    for (int ci : chain)
                        pushUnique(s.causalCells, nodes[ci].r * 9 + nodes[ci].c);
                    s.eliminationCells = cand.eliminationCells;
                    s.eliminations = cand.eliminations;
                    return true;
                }
            }
            if (dfs(startI, nb, !needStrong, nlc))
                return true;
            chain.pop_back();
            inChain[nb] = 0;
        }
        return false;
    };

    for (int i = 0; i < N; ++i)
    {
        if (strongAdj[i].empty())
            continue; // an AIC must begin with a strong link
        chain.clear();
        chain.push_back(i);
        inChain[i] = 1;
        const bool found = dfs(i, i, true, 0);
        inChain[i] = 0;
        if (found)
            return s;
    }
    return s;
}

// Tries the advanced techniques simplest-first; returns the first that fires.
FallbackHint runFallback(const Grid &g)
{
    FallbackHint s;
    if ((s = fbXyzWing(g)).found)
        return s;
    if ((s = fbUniqueRectangle(g)).found)
        return s;
    if ((s = fbXyChain(g)).found)
        return s;
    if ((s = fbAlsXZ(g)).found)
        return s;
    if ((s = fbAic(g)).found)
        return s;
    return s;
}

} // namespace

// Returns the next logical step as a JSON string, "null" when there is no
// logical step, or {"error":"..."} when the input cannot be parsed/solved.
//
// `puzzle`     — 81 chars, '1'-'9' for givens, '0'/'.' for empty cells.
// `candidates` — optional pencil marks so the hint respects work the player has
//                already done. Format: 81 cells separated by '|', each cell a
//                run of its candidate digits ("" for filled cells), e.g.
//                "|159|3|...". Empty string => derive full candidates from the
//                values (so consecutive hints would repeat an elimination-only
//                step until a value is placed).
std::string getHint(const std::string &puzzle, const std::string &candidates)
{
    Grid grid;
    if (!grid.fillValues(puzzle))
        return "{\"error\":\"invalid_format\"}";

    if (grid.isFull())
        return "null"; // already solved

    if (!candidates.empty())
        grid.fillNotes(candidates); // respect the player's pencil marks
    else if (grid.isNotesEmpty())
        grid.fillNotes(); // derive candidates from the given values

    // Reject boards with no completion so the UI can report it explicitly (the
    // ordered pipeline below never runs SimpleGuess / BruteForce, so it cannot
    // otherwise distinguish "unsolvable" from "no logical step").
    {
        Grid probe = grid;
        if (solver::techniques::bruteForce(probe, 1) == 0)
            return "{\"error\":\"unsolvable\"}";
    }

    // Single-step techniques in strict difficulty order, simplest-first. Locked
    // Candidates run *before* Hidden Single: their eliminations are often what
    // reveals a hidden single, so surfacing them first keeps the hint at the
    // lowest-difficulty step that makes progress. Each l2sg technique mutates
    // the grid only when it makes progress, so when one returns false the grid
    // is untouched for the next.
    struct OrderedTechnique
    {
        int rank;
        std::function<bool(Grid &, solver::Logs &)> run;
    };
    static const std::vector<OrderedTechnique> pipeline = {
        {1, [](Grid &g, solver::Logs &l) { return solver::techniques::nakedSingles(g, &l); }},
        {2, [](Grid &g, solver::Logs &l) { return solver::techniques::lockedCandidates(g, solver::LockedCandType::Type1Pointing, &l); }},
        {2, [](Grid &g, solver::Logs &l) { return solver::techniques::lockedCandidates(g, solver::LockedCandType::Type2Claiming, &l); }},
        {3, [](Grid &g, solver::Logs &l) { return solver::techniques::hiddenSingles(g, &l); }},
        {4, [](Grid &g, solver::Logs &l) { return solver::techniques::nakedMulti(g, solver::NakedMultiType::Pair, &l); }},
        {5, [](Grid &g, solver::Logs &l) { return solver::techniques::hiddenMulti(g, solver::HiddenMultiType::Pair, &l); }},
        {6, [](Grid &g, solver::Logs &l) { return solver::techniques::nakedMulti(g, solver::NakedMultiType::Triple, &l); }},
        {7, [](Grid &g, solver::Logs &l) { return solver::techniques::hiddenMulti(g, solver::HiddenMultiType::Triple, &l); }},
        {8, [](Grid &g, solver::Logs &l) { return solver::techniques::nakedMulti(g, solver::NakedMultiType::Quadruple, &l); }},
        {9, [](Grid &g, solver::Logs &l) { return solver::techniques::hiddenMulti(g, solver::HiddenMultiType::Quadruple, &l); }},
        {10, [](Grid &g, solver::Logs &l) { return solver::techniques::xWings(g, &l); }},
        {11, [](Grid &g, solver::Logs &l) { return solver::techniques::basicFish(g, solver::BasicFishType::Swordfish, &l); }},
        {12, [](Grid &g, solver::Logs &l) { return solver::techniques::basicFish(g, solver::BasicFishType::Jellyfish, &l); }},
        {13, [](Grid &g, solver::Logs &l) { return solver::techniques::skyscraper(g, &l); }},
        {14, [](Grid &g, solver::Logs &l) { return solver::techniques::twoStringKite(g, &l); }},
        {15, [](Grid &g, solver::Logs &l) { return solver::techniques::xyWing(g, &l); }},
        {16, [](Grid &g, solver::Logs &l) { return solver::techniques::wWing(g, &l); }},
    };

    for (const auto &technique : pipeline)
    {
        solver::Logs logs;
        if (!technique.run(grid, logs) || logs.empty())
            continue;

        // A technique logs one entry per pattern it applies; the first entry is
        // the step we surface as the hint.
        const solver::Log &step = logs.front();

        std::vector<int> causalCells;
        std::vector<int> eliminationCells;
        std::vector<std::pair<int, int>> eliminations; // (cellIndex, digit)
        int placementCell = -1;
        int placementDigit = 0;

        for (const auto &cellLog : step.cellLogs)
        {
            const int idx = cellIndex(cellLog.cell);
            switch (cellLog.action)
            {
                case CellAction::AppliedValue:
                    placementCell = idx;
                    placementDigit = cellLog.value;
                    pushUnique(causalCells, idx);
                    break;
                case CellAction::RemovedNote:
                    eliminations.emplace_back(idx, cellLog.value);
                    pushUnique(eliminationCells, idx);
                    break;
                case CellAction::InPatternN1:
                case CellAction::InPatternN2:
                    pushUnique(causalCells, idx);
                    break;
                default:
                    break; // diagnostic actions are not surfaced as hints
            }
        }

        return buildHintJson(solver::technique2Str(step.technique), technique.rank, causalCells,
                             eliminationCells, eliminations, placementCell, placementDigit);
    }

    // No l2sg technique applied; try the advanced elimination-only fallbacks.
    const FallbackHint fb = runFallback(grid);
    if (fb.found)
        return buildHintJson(fb.technique, fb.difficulty, fb.causalCells, fb.eliminationCells,
                             fb.eliminations, -1, 0);

    return "null"; // no logical step available from here
}

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_BINDINGS(l2sg_hint)
{
    emscripten::function("getHint", &getHint);
}
#endif
