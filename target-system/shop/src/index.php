<?php
header('Cache-Control: no-store');

$products = [
    ['code' => 'ETH', 'name' => 'Ethiopia Yirgacheffe', 'origin' => 'Gedeo zone, washed', 'notes' => 'Jasmine, bergamot, wildflower honey', 'roast' => 'Light', 'price' => 16.50, 'tone' => 'yellow'],
    ['code' => 'COL', 'name' => 'Colombia Huila', 'origin' => 'La Plata, washed', 'notes' => 'Red apple, caramel, cocoa nib', 'roast' => 'Medium', 'price' => 14.00, 'tone' => 'red'],
    ['code' => 'KEN', 'name' => 'Kenya Nyeri AA', 'origin' => 'Othaya, double washed', 'notes' => 'Blackcurrant, grapefruit, cane sugar', 'roast' => 'Light', 'price' => 17.50, 'tone' => 'blue'],
    ['code' => 'GUA', 'name' => 'Guatemala Antigua', 'origin' => 'Antigua valley, washed', 'notes' => 'Milk chocolate, toffee, orange zest', 'roast' => 'Medium', 'price' => 14.50, 'tone' => 'green'],
    ['code' => 'HSE', 'name' => 'House Espresso', 'origin' => 'Brazil and Colombia blend', 'notes' => 'Dark chocolate, hazelnut, molasses', 'roast' => 'Medium-dark', 'price' => 13.00, 'tone' => 'stone'],
    ['code' => 'DEC', 'name' => 'Decaf Mexico', 'origin' => 'Chiapas, Swiss Water process', 'notes' => 'Cocoa, roasted almond, brown sugar', 'roast' => 'Medium', 'price' => 13.50, 'tone' => 'blue'],
];

function e(string $value): string
{
    return htmlspecialchars($value, ENT_QUOTES, 'UTF-8');
}
?>
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Acme Coffee Roasters - Small-batch coffee, roasted to order</title>
<style>
  :root {
    --canvas: #F7F6F3;
    --surface: #FFFFFF;
    --ink: #2F3437;
    --ink-strong: #111111;
    --muted: #787774;
    --line: #EAEAEA;
    --serif: ui-serif, "New York", "Iowan Old Style", "Palatino Linotype", Georgia, serif;
    --sans: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Helvetica, Arial, sans-serif;
    --mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--canvas); color: var(--ink); font: 16px/1.6 var(--sans); -webkit-font-smoothing: antialiased; }
  a { color: inherit; text-decoration: none; }
  .wrap { max-width: 1080px; margin: 0 auto; padding: 0 32px; }

  header { border-bottom: 1px solid var(--line); background: rgba(247, 246, 243, 0.85); backdrop-filter: blur(8px); position: sticky; top: 0; z-index: 2; }
  .bar { display: flex; align-items: center; justify-content: space-between; height: 68px; }
  .brand { font-family: var(--serif); font-size: 21px; letter-spacing: -0.02em; color: var(--ink-strong); }
  nav { display: flex; gap: 28px; font-size: 14px; color: var(--muted); }
  nav a:hover { color: var(--ink-strong); }
  .cart { font-size: 14px; border: 1px solid var(--line); background: var(--surface); padding: 7px 14px; border-radius: 6px; }

  .hero { padding: 96px 0 72px; }
  .eyebrow { font: 500 12px/1 var(--mono); letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
  h1 { font-family: var(--serif); font-weight: 400; font-size: clamp(40px, 6vw, 64px); line-height: 1.08; letter-spacing: -0.035em; color: var(--ink-strong); margin: 20px 0 20px; max-width: 14ch; }
  .lede { font-size: 18px; color: var(--muted); max-width: 52ch; margin: 0; }

  .section-head { display: flex; align-items: baseline; justify-content: space-between; border-top: 1px solid var(--line); padding: 28px 0 24px; }
  .section-head h2 { font-family: var(--serif); font-weight: 400; font-size: 26px; letter-spacing: -0.02em; margin: 0; color: var(--ink-strong); }
  .section-head span { font-size: 14px; color: var(--muted); }

  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(280px, 100%), 1fr)); gap: 20px; padding-bottom: 96px; }
  .card { background: var(--surface); border: 1px solid var(--line); border-radius: 12px; overflow: hidden; display: flex; flex-direction: column; transition: box-shadow 200ms ease; animation: rise 600ms cubic-bezier(0.16, 1, 0.3, 1) both; animation-delay: calc(var(--i) * 80ms); }
  .card:hover { box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04); }
  .art { aspect-ratio: 4 / 3; max-height: 260px; display: grid; place-items: center; border-bottom: 1px solid var(--line); }
  .art svg { height: 72%; }
  .art text { font: 600 15px var(--mono); letter-spacing: 0.08em; fill: var(--ink); }
  .tone-yellow { background: #FBF3DB; } .tone-red { background: #FDEBEC; } .tone-blue { background: #E1F3FE; }
  .tone-green { background: #EDF3EC; } .tone-stone { background: #F1EFEA; }
  .body { padding: 22px 24px 24px; display: flex; flex-direction: column; gap: 6px; flex: 1; }
  .meta { display: flex; justify-content: space-between; font: 12px/1.4 var(--mono); color: var(--muted); letter-spacing: 0.02em; }
  .card h3 { font-family: var(--serif); font-weight: 400; font-size: 22px; letter-spacing: -0.02em; margin: 4px 0 0; color: var(--ink-strong); }
  .notes { color: var(--muted); font-size: 15px; margin: 0 0 14px; }
  .buy { margin-top: auto; display: flex; align-items: center; justify-content: space-between; }
  .price { font-size: 17px; color: var(--ink-strong); }
  .price small { color: var(--muted); font-size: 13px; }
  button { font: 500 14px var(--sans); background: var(--ink-strong); color: #FFFFFF; border: 0; border-radius: 6px; padding: 9px 16px; cursor: pointer; transition: background 150ms ease, transform 150ms ease; }
  button:hover { background: #333333; }
  button:active { transform: scale(0.98); }

  .facts { display: grid; grid-template-columns: repeat(3, 1fr); border-top: 1px solid var(--line); }
  .fact { padding: 32px 32px 40px 0; }
  .fact + .fact { padding-left: 32px; border-left: 1px solid var(--line); }
  .fact h4 { margin: 0 0 6px; font-size: 15px; color: var(--ink-strong); font-weight: 600; }
  .fact p { margin: 0; color: var(--muted); font-size: 15px; }

  footer { border-top: 1px solid var(--line); margin-top: 40px; }
  .foot { display: flex; justify-content: space-between; padding-top: 28px; padding-bottom: 40px; font-size: 13px; color: var(--muted); }
  .powered { font-family: var(--mono); }

  @keyframes rise { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
  @media (max-width: 900px) { nav { display: none; } }
  @media (max-width: 760px) {
    .facts { grid-template-columns: 1fr; }
    .fact, .fact + .fact { padding: 24px 0; border-left: 0; }
    .fact + .fact { border-top: 1px solid var(--line); }
    .foot { flex-direction: column; gap: 6px; }
  }
  @media (prefers-reduced-motion: reduce) { .card { animation: none; } }
</style>
</head>
<body>
<svg width="0" height="0" style="position:absolute" aria-hidden="true">
  <symbol id="bag" viewBox="0 0 120 150">
    <path d="M30 8h60l8 18H22z" fill="#FFFFFF" stroke="#2F3437" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M22 26h76l7 112a6 6 0 0 1-6 6H21a6 6 0 0 1-6-6z" fill="#FFFFFF" stroke="#2F3437" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M44 8l-3 18M76 8l3 18" stroke="#2F3437" stroke-width="2" stroke-linecap="round"/>
    <rect x="33" y="62" width="54" height="44" rx="3" fill="none" stroke="#2F3437" stroke-width="2"/>
  </symbol>
</svg>

<header>
  <div class="wrap bar">
    <a class="brand" href="/">Acme Coffee Roasters</a>
    <nav>
      <a href="/">Coffee</a>
      <a href="/">Subscriptions</a>
      <a href="/">Wholesale</a>
      <a href="/">Our roastery</a>
    </nav>
    <a class="cart" href="/">Bag (0)</a>
  </div>
</header>

<main class="wrap">
  <section class="hero">
    <div class="eyebrow">Roasted Tuesday &middot; Shipped Wednesday</div>
    <h1>Small-batch coffee, roasted to order.</h1>
    <p class="lede">Single origins and blends from farms we buy from directly, roasted in Rotterdam in 12 kg batches. Free shipping in the EU on orders over &euro;35.</p>
  </section>

  <div class="section-head">
    <h2>This week's coffees</h2>
    <span><?= count($products) ?> coffees &middot; 250 g bags, whole bean or ground</span>
  </div>

  <section class="grid">
    <?php foreach ($products as $i => $p): ?>
    <article class="card" style="--i: <?= $i ?>">
      <div class="art tone-<?= e($p['tone']) ?>">
        <svg viewBox="0 0 120 150" role="img" aria-label="<?= e($p['name']) ?> bag">
          <use href="#bag"/>
          <text x="60" y="89" text-anchor="middle"><?= e($p['code']) ?></text>
        </svg>
      </div>
      <div class="body">
        <div class="meta"><span><?= e($p['origin']) ?></span><span><?= e($p['roast']) ?></span></div>
        <h3><?= e($p['name']) ?></h3>
        <p class="notes"><?= e($p['notes']) ?></p>
        <div class="buy">
          <span class="price">&euro;<?= number_format($p['price'], 2) ?> <small>/ 250 g</small></span>
          <button type="button">Add to bag</button>
        </div>
      </div>
    </article>
    <?php endforeach; ?>
  </section>

  <section class="facts">
    <div class="fact"><h4>Roast day is Tuesday</h4><p>Every order is roasted fresh and leaves the roastery within 24 hours.</p></div>
    <div class="fact"><h4>Direct trade</h4><p>We pay producers at least 40% above the commodity price, every harvest.</p></div>
    <div class="fact"><h4>Brew guides</h4><p>Recipes for filter, espresso and cold brew with every bag.</p></div>
  </section>
</main>

<footer>
  <div class="wrap foot">
    <span>&copy; <?= date('Y') ?> Acme Coffee Roasters &middot; Rotterdam</span>
    <span class="powered">Powered by PHP <?= PHP_VERSION ?></span>
  </div>
</footer>
</body>
</html>
