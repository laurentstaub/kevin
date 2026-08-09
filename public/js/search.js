// Autocomplétion de la barre de recherche.
// Interroge /api/suggest — endpoint borné à quelques lignes, distinct de la
// recherche complète : taper ne déclenche jamais la requête lourde.

const form = document.querySelector('.search-form');
const input = form?.querySelector('.search-input');
const dropdown = document.getElementById('suggestions');
const list = dropdown?.querySelector('.suggestions-list');
const loading = document.getElementById('loading');

if (form && input && dropdown && list) {
  const MIN_LENGTH = 3;
  let items = [];
  let cursor = -1;
  let controller = null;

  const show = () => {
    dropdown.hidden = false;
  };

  const hide = () => {
    dropdown.hidden = true;
    cursor = -1;
    paint();
  };

  const paint = () => {
    [...list.children].forEach((el, i) => {
      el.classList.toggle('selected', i === cursor);
      el.setAttribute('aria-selected', String(i === cursor));
    });
  };

  const render = (suggestions) => {
    list.replaceChildren();
    cursor = -1;

    suggestions.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'suggestion-item';
      row.setAttribute('role', 'option');

      const name = document.createElement('div');
      name.className = 'suggestion-name';
      name.textContent = item.name;

      // Douze codes CIS peuvent porter la même dénomination : la marque et le
      // titulaire sont les seules choses qui distinguent les lignes.
      if (item.parallel) {
        const marque = document.createElement('span');
        marque.className = 'marque';
        marque.textContent = 'Importation parallèle';
        name.append(marque);
      }
      row.append(name);

      const detail = [item.holder, item.substances].filter(Boolean).join(' · ');
      if (detail) {
        const sub = document.createElement('div');
        sub.className = 'suggestion-active-ingredients';
        sub.textContent = detail;
        row.append(sub);
      }

      // Une suggestion couvre tout un produit : dire combien de présentations
      // évite de croire qu'on ne propose qu'un dosage.
      const etendue = [
        item.presentations > 1 ? `${item.presentations} dosages et formes` : null,
        item.variants > 0
          ? `${item.variants} importation${item.variants > 1 ? 's' : ''} parallèle${item.variants > 1 ? 's' : ''}`
          : null,
      ].filter(Boolean);

      if (etendue.length > 0) {
        const autres = document.createElement('div');
        autres.className = 'suggestion-variantes';
        autres.textContent = etendue.join(' · ');
        row.append(autres);
      }

      row.addEventListener('click', () => {
        window.location.href = `/product/${item.id}`;
      });
      row.addEventListener('mouseenter', () => {
        cursor = [...list.children].indexOf(row);
        paint();
      });

      list.append(row);
    });

    show();
  };

  const fetchSuggestions = async (value) => {
    if (value.length < MIN_LENGTH) return hide();

    controller?.abort();
    controller = new AbortController();
    loading.style.display = 'block';

    try {
      const res = await fetch(`/api/suggest?q=${encodeURIComponent(value)}`, {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(res.statusText);

      const data = await res.json();
      items = data.suggestions ?? [];
      items.length > 0 ? render(items) : hide();
    } catch (err) {
      if (err.name !== 'AbortError') hide();
    } finally {
      loading.style.display = 'none';
    }
  };

  const debounce = (fn, wait) => {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), wait);
    };
  };

  const debounced = debounce(fetchSuggestions, 250);

  input.addEventListener('input', (e) => debounced(e.target.value.trim()));

  input.addEventListener('keydown', (e) => {
    const count = list.children.length;
    if (count === 0) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        cursor = Math.min(cursor + 1, count - 1);
        paint();
        break;
      case 'ArrowUp':
        e.preventDefault();
        cursor = Math.max(cursor - 1, -1);
        paint();
        break;
      case 'Enter':
        if (cursor >= 0 && items[cursor]) {
          e.preventDefault();
          window.location.href = `/product/${items[cursor].id}`;
        }
        break;
      case 'Escape':
        hide();
        input.blur();
        break;
    }
  });

  document.addEventListener('click', (e) => {
    if (!form.contains(e.target)) hide();
  });

  form.addEventListener('submit', hide);
}
