# Rotas Shopee — v0.1

Aplicativo web instalável (PWA) para importar, separar, roteirizar e executar entregas da Shopee.
Região inicial: Bom Retiro, Ipatinga/MG.

## O que já funciona

| Área | Situação |
|---|---|
| Importar PDF de rota organizada | ✔ Testado com `Rota-05-11-Grupos-1-a-8(1).pdf`: 76 paradas, 8 grupos, 125 pacotes |
| Importar planilha (.xlsx/.xls/.csv) | ✔ Detecta colunas automaticamente e permite remapear. **Ainda não testado com uma exportação real da Shopee** |
| `+1`, `+2`… | ✔ Contados como pacotes adicionais sem número (`#103 #104 #105 +1` = 4) |
| Conferência da importação | ✔ Cabeçalho × encontrado (77 × 76), por grupo, etiquetas repetidas/ausentes (#58), divergência citada na observação (#94) |
| Separação por grupo (número + cor) e busca de etiqueta | ✔ |
| Tela de entrega + Waze | ✔ Entregue / Não entregue (com motivo) / Pular, entrega parcial, desfazer |
| Correção de endereço | ✔ Preserva o original da Shopee; refaz a localização e marca a rota para recalcular |
| Localização (geocodificação) | ✔ OpenStreetMap/Nominatim + GPS na porta + marcação no mapa. Coordenadas conferidas são reaproveitadas nas próximas rotas |
| Otimização pela malha viária | ✔ Matriz de tempos de carro (OSRM), TSP assimétrico, penalidades por voltar à rua e por atravessar a avenida divisora; grupos cortados depois, sobre a ordem global |
| Auditoria | ✔ Ao sair da rua (todas as pendências, de qualquer grupo), antes de atravessar a Av. Fernando de Noronha e quando há pendência a < 300 m e a próxima está longe. Continuar exige justificativa. Nunca marca entrega sozinho |
| Persistência | ✔ localStorage (o progresso sobrevive a fechar a página) |

### Como a rota é rotulada (sem enganar)
- **Ordem do arquivo** — exatamente como importado; não otimizada.
- **Aproximada (linha reta)** — fallback quando o serviço de rotas falha. Não considera mão única.
- **Otimizada pela malha viária** — só quando a matriz veio do OSRM (tempos de carro pelas ruas).

## Testar no celular (iPhone)

O app precisa estar num endereço **https** para usar GPS, mapa, geocodificação e instalar na tela inicial.
O jeito mais simples (grátis, sem programar):

1. No computador, acesse **https://app.netlify.com/drop** (crie uma conta grátis se pedir).
2. Arraste a pasta **`dist`** (está dentro do zip) para a página.
3. O Netlify mostra um endereço tipo `https://nome-aleatorio.netlify.app`. Abra no Safari do iPhone.
4. Para instalar: botão **Compartilhar → Adicionar à Tela de Início**.
5. Teste: **Importar → Escolher arquivo** (PDF ou planilha) → **Rota → 1. Localizar endereços → 2. Otimizar pela malha viária** → **Separar** → **Entregar**.

> Localizar 76 endereços leva ~1,5 min (o Nominatim permite 1 consulta por segundo). Os resultados ficam em cache.

## Rodar no computador (desenvolvimento)

```bash
npm install
npm run dev          # http://localhost:5173 (no celular, mesma rede Wi-Fi: use o IP do computador)
npx vitest run       # 21 testes, incluindo o PDF real (ROUTE_PDF=/caminho/rota.pdf)
npm run build        # gera dist/
```

## Arquitetura

```
src/
  domain/        modelo (Stop, Package, Group, RoutePlan), +N, endereços, cores
  importers/     pdfRoute (PDF), spreadsheet (xlsx/csv), validate (conferência)
  services/
    geocoding/   interface GeocodingProvider + Nominatim
    routing/     interface MatrixProvider + OSRM + linha reta (fallback)
    divider.ts   avenida divisora (Overpass/OSM) e lado de cada parada
    pipeline.ts  localizar → avenida → matriz → otimizar
  optimize/      sequence (TSP assimétrico + penalidades), groups (cortes), plan, worker
  audit/         regras da auditoria de rua/avenida/proximidade
  integrations/  waze
  store/         estado (zustand) + persistence (trocar por API/banco aqui)
  ui/            telas e componentes
tests/           vitest
```

Pontos de evolução sem reconstruir:
- **Banco de dados / sincronização:** substituir `store/persistence.ts` por um armazenamento que também envie à API.
- **Motor de rotas próprio:** apontar o campo "Servidor OSRM" (aba Rota → Ajustes) para um OSRM próprio com o mapa de MG, ou implementar `MatrixProvider` para GraphHopper/Google/Mapbox.
- **Geocodificador pago (mais preciso):** implementar `GeocodingProvider`.
- **Regras locais (conversões proibidas, ruas de mão única que faltam no mapa):** corrigir no OpenStreetMap beneficia o OSRM; ou adicionar penalidades em `optimize/sequence.ts`.

## Limitações conhecidas (v0.1)
- Os serviços públicos (Nominatim, OSRM demo, Overpass) são para teste e têm limite de uso. Para uso diário, contratar ou hospedar um serviço.
- Em Ipatinga, muitos imóveis não têm número no OpenStreetMap: a parada fica "só pela rua" (marcador tracejado). Nesse caso o Waze recebe o endereço em texto, não a coordenada. Use "Estou na porta: usar GPS" para fixar a posição — ela é reaproveitada nas próximas rotas.
- A qualidade da mão única/conversões depende do que está cadastrado no OpenStreetMap.
- O Waze não devolve confirmação de chegada/entrega; a marcação é sempre manual.
