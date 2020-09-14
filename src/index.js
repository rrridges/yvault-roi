var d3 = require("d3");
var _ = require("lodash");

console.log('hi');

let api = "https://api.thegraph.com/subgraphs/name/rrridges-crypto/yearn-vault-roi-dev";

var formatter = function (n) {
  if (Math.abs(n) < 1) {
    return d3.format(',.4r')(n)
  } else {
    return d3.format(',.2f')(n)
  }
}

//getVaults(); // Hard-code for now instead of grabbing dynamically
readURLSearchParams();

d3.select('#calculate')
  .on('click', function () {
    let accountAddress = d3.select('#accountAddress').node().value.toLowerCase();
    let vaultAddress = d3.select('#vaultAddress').node().value.toLowerCase();
    let includeTransfers = d3.select('#includeTransfers').node().checked;

    var params = new URLSearchParams();
    params.set('accountAddress', accountAddress);
    params.set('vaultAddress', vaultAddress);
    window.history.replaceState({}, '', '?' + params.toString());

    calculate(accountAddress, vaultAddress, includeTransfers);
  })

function readURLSearchParams() {
  let params = new URLSearchParams(window.location.search);
  var accountAddress = params.get('accountAddress');
  var vaultAddress = params.get('vaultAddress');

  console.log(vaultAddress);

  if (vaultAddress) {
    d3.select('#vaultAddress').property('value', vaultAddress);
  }
  if (accountAddress) {
    d3.select('#accountAddress').attr('value', accountAddress);
  }
}

function requestOptions() {
  return {
    method: 'POST',
    headers: new Headers().append("Content-Type", "application/json"),
    redirect: 'follow'
  };
}

async function getVaults() {
  var options = requestOptions();
  var graphql = vaultsQuery();
  options.body = graphql;
  let response = await fetch(api, options)
  let result = await response.json();
  console.log(result);

  d3.select('#vaultAddress').selectAll('option')
    .data(result.data.vaults)
    .enter()
    .append('option')
    .attr('value', d => d.id)
    .text(d => d.symbol)
}

async function calculate(accountAddress, vaultAddress, includeTransfers) {

  // Clear any previous search
  d3.select('#cons').html("");
  d3.select('#container').html("");
  d3.selectAll('.results').style('visibility', 'hidden')

  // Get deposits & withdrawals
  d3.select('#cons').text('Fetching activity...');

  var graphql = activityQuery(accountAddress, vaultAddress);
  var options = requestOptions();
  options.body = graphql;
  let response = await fetch(api, options)
  let result = await response.json();
  let deposits = result.data.deposits;
  let withdraws = result.data.withdraws;
  let transfers = includeTransfers ? result.data.transfersOut.concat(result.data.transfersIn) : [];


  // Prepare to fetch 'getPricePerFullShare' at regular intervals
  d3.select('#cons').text('Fetching performance...');
  let depositBlocks = deposits.map(deposit => +deposit.blockNumber);
  let withdrawBlocks = withdraws.map(withdraw => +withdraw.blockNumber);
  let transferBlocks = transfers.map(transfer => +transfer.blockNumber);
  let start = Math.min(...depositBlocks, ...withdrawBlocks, ...transferBlocks);
  let end = result.data.lastBlock[0].blockNumber; // latest block number in the 'transfers' collection
  let blocksToFetch = _.uniq(_.range(start, end, 2160).concat(depositBlocks).concat(withdrawBlocks).concat(transferBlocks).sort());

  // Fetch 'getPricePerFullShare' for each graph datapoint
  var graphql = blockPriceQuery(blocksToFetch, vaultAddress);
  options.body = graphql;
  let resp = await fetch(api, options);
  let res = await resp.json();

  // Sanitize the result
  let vaultPrice = blocksToFetch.map(blockNumber => ({
    blockNumber: blockNumber,
    pricePerFullShare: +res.data['v' + blockNumber][0].getPricePerFullShare / 1e18,
  }));

  // Clear loading text
  d3.select('#cons').text('');

  // Calculate invested amount & account balance for each datapoint
  let balanceData = [];
  vaultPrice.forEach(block => {
    let c_deposits = deposits.filter(d => d.blockNumber <= block.blockNumber); // c stands for cumulative
    let c_withdraws = withdraws.filter(w => w.blockNumber <= block.blockNumber);
    let c_transfers = transfers.filter(t => t.blockNumber <= block.blockNumber).map(t => ({
      value: (t.to.toLowerCase() == accountAddress.toLowerCase() ? t.value : -t.value) * t.getPricePerFullShare / 1e18,
      shares: t.to.toLowerCase() == accountAddress.toLowerCase() ? t.value : -t.value,
    }));

    let invested = _.sum(c_deposits.map(d => d.amount / 1e18))
      + _.sum(c_transfers.map(t => t.value / 1e18))
      - _.sum(c_withdraws.map(w => w.amount / 1e18));
    let balance = (_.sum(c_deposits.map(d => d.shares / 1e18))
      + _.sum(c_transfers.map(t => t.shares / 1e18))
      - _.sum(c_withdraws.map(w => w.shares / 1e18))) * block.pricePerFullShare;

    balanceData.push({
      blockNumber: block.blockNumber,
      invested: invested,
      balance: balance,
    })
  });

  drawTable(balanceData, deposits, withdraws, transfers, start, end, vaultPrice);
  drawMoneyWeightedChart(balanceData);
  drawTimeWeightedChart(vaultPrice);
  d3.selectAll('.results').style('visibility', 'visible');
}

function blockPriceQuery(blocksToFetch, vaultAddress) {
  var query = '{\n';
  blocksToFetch.forEach(blockNumber => {
    query += `
    	v${blockNumber}: vaults(where: {id: "${vaultAddress}"}, block: {number: ${blockNumber}}) {
        getPricePerFullShare
      }
      
    `
  })
  query += '}';
  return JSON.stringify({ query: `${query}` });
}

function vaultsQuery() {
  return JSON.stringify({
    query: `
    { 
      vaults {
        id
        symbol
        name
      }
    }`,
    variables: {}
  })
}



function activityQuery(accountAddress, vaultAddress) {
  return JSON.stringify({
    query: `
    { 
      deposits (where: {account: "${accountAddress}", vaultAddress: "${vaultAddress}"}, orderBy: blockNumber) {
        id
        vaultAddress
        account
        amount
        shares
        timestamp
        blockNumber
      }
      withdraws (where: {account: "${accountAddress}", vaultAddress: "${vaultAddress}"}, orderBy: blockNumber) {
        id
        vaultAddress
        account
        amount
        shares
        timestamp
        blockNumber
      }
      transfersOut: transfers(where: {from: "${accountAddress}", vaultAddress: "${vaultAddress}", to_not: "0x0000000000000000000000000000000000000000"}, orderBy: blockNumber) {
      	id
    		from
    		to
    		value
    		blockNumber
    		vaultAddress
        getPricePerFullShare
      }
      transfersIn: transfers(where: {to: "${accountAddress}", vaultAddress: "${vaultAddress}", from_not: "0x0000000000000000000000000000000000000000"}, orderBy: blockNumber) {
      	id
    		from
    		to
    		value
    		blockNumber
    		vaultAddress
        getPricePerFullShare
      }
      lastBlock: transfers (first: 1, orderBy: blockNumber, orderDirection: desc) {
      	blockNumber
      }
    }`,
    variables: {}
  })
}

function drawTable(balanceData, deposits, withdraws, transfers, start, end, vaultPrice) {

  var netDeposits = balanceData[balanceData.length - 1].invested;
  var earnings = balanceData[balanceData.length - 1].balance - netDeposits;
  var simpleReturn = earnings / netDeposits;
  var blocksPerYear = 4 * 60 * 24 * 365; // ~one block every 15 seconds
  var yearFraction = (end - start) / blocksPerYear;
  var annualizedSimpleReturn = ((1 + simpleReturn) ** (1 / yearFraction)) - 1;
  var simpleReturnStr = (netDeposits > 0) ?
    `${formatter(simpleReturn * 100) + '%'} / Annualized ${formatter(annualizedSimpleReturn * 100) + '%'}`
    : 'N/A';

  // Modified Dietz IRR: https://en.wikipedia.org/wiki/Modified_Dietz_method
  var A = balanceData[0].balance;
  var B = balanceData[balanceData.length - 1].balance;
  var F = netDeposits - balanceData[0].invested;
  var cf = [];
  deposits.forEach(deposit => { cf.push({ flow: deposit.amount / 1e18, blockNumber: deposit.blockNumber }) });
  withdraws.forEach(withdraw => { cf.push({ flow: -withdraw.amount / 1e18, blockNumber: withdraw.blockNumber }) });
  transfers.forEach(transfer => { cf.push({ flow: transfer.value / 1e18, blockNumber: transfer.blockNumber }) });
  var wcf = _.sum(cf.map(f => f.flow * ((end - f.blockNumber) / (end - start))))

  var irr = (B - A - F) / wcf;
  var annualizedIrr = ((1 + irr) ** (1 / yearFraction)) - 1;

  var timeReturn = vaultPrice[vaultPrice.length - 1].pricePerFullShare / vaultPrice[0].pricePerFullShare - 1;
  var annualizedTimeReturn = ((1 + timeReturn) ** (1 / yearFraction)) - 1;



  // Print out metrics
  d3.select('#money-weighted-stats').html(
    `Net Deposits: ${formatter(netDeposits)}
Earnings: ${ formatter(earnings)}
Simple Return: ${simpleReturnStr}
IRR: ${ formatter(irr * 100) + '%'} / Annualized ${formatter(annualizedIrr * 100) + '%'}
<a href="https://www.betterment.com/resources/performance-design/">What do these numbers mean?</a>`)

  d3.select('#time-weighted-stats').html(
    `Time-Weighted Return: ${formatter(timeReturn * 100) + '%'} / Annualized ${formatter(annualizedTimeReturn * 100) + '%'}
<a href="https://www.betterment.com/resources/performance-design/">What do these numbers mean?</a>`)

}

function drawMoneyWeightedChart(balanceData) {
  // Draw the graph
  let height = 400, width = 400;

  let lineChart = d3.select('#container')
    .append('g')
    .attr('id', 'linechart')
    .style('transform', `translate(75px,50px)`)

  let x = d3.scaleLinear()
    .domain(d3.extent(balanceData.map(b => b.blockNumber)))
    .range([0, width]);
  let y = d3.scaleLinear()
    .domain(d3.extent(balanceData.map(b => b.balance).concat(0)))
    .range([height, 0]);

  lineChart.append("g")
    .attr("transform", "translate(0," + height + ")")
    .call(d3.axisBottom(x).ticks(4));

  lineChart.append("g")
    .attr('class', 'axis')
    .call(d3.axisLeft(y).ticks(5));

  lineChart.append("path")
    .datum(balanceData)
    .attr("fill", "#F25E6C80")
    .attr("stroke", '#F25E6C80')
    .attr("stroke-width", 1)
    .attr("d", d3.area().curve(d3.curveStepAfter)
      .x(d => x(d.blockNumber))
      .y0(height)
      .y1(d => y(d.balance))
    )
  lineChart.append("path")
    .datum(balanceData)
    .attr("fill", "#3A60E980")
    .attr("stroke", '#3A60E980')
    .attr("stroke-width", 1)
    .attr("d", d3.area().curve(d3.curveStepAfter)
      .x(d => x(d.blockNumber))
      .y0(height)
      .y1(d => y(d.invested))
    )

  // Create the circle that travels along the curve of chart
  var focus = lineChart
    .append('g')
    .append('path')
    .style("stroke", "#666")
    .style("stroke-width", "0.5px")
    .style("stroke-dasharray", "5,5")
    .style("opacity", 0)

  // Create the text that travels along the curve of chart
  var focusText = lineChart
    .append('g')
    .attr('transform', 'translate(15, -30)')
    .append('g')
    .style('opacity', 0)

  focusText.append('rect')
    .attr('y', -10)
    .attr('width', 10)
    .attr('height', 10)
    .style('fill', '#F25E6C80')

  focusText.append('rect')
    .attr('y', 5)
    .attr('width', 10)
    .attr('height', 10)
    .style('fill', '#3A60E980')


  var focusBalance = focusText.append('text')
    .attr('x', 20)
  var focusInvested = focusText.append('text')
    .attr('x', 20)
    .attr('dy', '1.2em')


  // Create a rect on top of the svg area: this rectangle recovers mouse position
  lineChart
    .append('rect')
    .style("fill", "none")
    .style("pointer-events", "all")
    .attr('width', width)
    .attr('height', height)
    .on('mouseover', mouseover)
    .on('mousemove', mousemove)
    .on('mouseout', mouseout);

  function mouseover() {
    focus.style("opacity", 1)
    focusText.style("opacity", 1)
  }

  var bisect = d3.bisector(function (d) { return d.blockNumber; }).right;

  function mousemove(event) {
    // recover coordinate we need
    var pointerX = d3.pointer(event)[0]
    var x0 = x.invert(pointerX);
    var i = bisect(balanceData, x0);

    selectedData = balanceData[i - 1]
    focus
      .attr("d", function () {
        var d = "M" + pointerX + "," + 0;
        d += " " + pointerX + "," + height;
        d += "M" + 0 + "," + y(selectedData.balance);
        d += " " + width + "," + y(selectedData.balance);
        return d;
      })
    focusText
      .attr('transform', `translate(${pointerX},${y(selectedData.balance)})`)
    focusBalance.html("Balance: " + formatter(selectedData.balance));
    focusInvested.html("Invested: " + formatter(selectedData.invested));
  }
  function mouseout() {
    focus.style("opacity", 0)
    focusText.style("opacity", 0)
  }
}

function drawTimeWeightedChart(vaultPrice) {

  console.log(vaultPrice);
  console.log(d3.extent(vaultPrice.map(d => d.pricePerFullShare)))

  var firstPrice = vaultPrice[0].pricePerFullShare;
  var roi = vaultPrice.map(d => ({ blockNumber: d.blockNumber, roi: d.pricePerFullShare / firstPrice }));

  console.log(roi);

  // Draw the graph
  let height = 400, width = 400;

  let lineChart = d3.select('#container')
    .append('g')
    .attr('id', 'linechart')
    .style('transform', `translate(575px,50px)`)

  let x = d3.scaleLinear()
    .domain(d3.extent(vaultPrice.map(d => d.blockNumber)))
    .range([0, width]);
  let y = d3.scaleLinear()
    .domain([1, d3.max(roi.map(d => d.roi))])
    .range([height, 0]);

  lineChart.append("g")
    .attr("transform", "translate(0," + height + ")")
    .call(d3.axisBottom(x).ticks(4));

  lineChart.append("g")
    .attr('class', 'axis')
    .call(d3.axisLeft(y).ticks(5).tickFormat(t => ((t - 1) * 100).toFixed(1) + '%'));

  lineChart.append("path")
    .datum(roi)
    .style('fill', 'none')
    .attr("stroke", '#3A60E9')
    .attr("stroke-width", 1.5)
    .attr("d", d3.line()
      .x(d => x(d.blockNumber))
      .y(d => y(d.roi))
    )

  // Create the circle that travels along the curve of chart
  var focusLine = lineChart
    .append('g')
    .append('path')
    .style("stroke", "#666")
    .style("stroke-width", "0.5px")
    .style("stroke-dasharray", "5,5")
    .style("opacity", 0)

  var focusCircle = lineChart
    .append('g')
    .append('circle')
    .attr('r', 5)
    .attr('x', 0)
    .attr('y', 0)
    .style("stroke", "#666")
    .style("stroke-width", "0.5px")
    .style("fill", "none")
    .style("opacity", 0)

  // Create the text that travels along the curve of chart
  var focusText = lineChart
    .append('text')
    .attr('x', 10)
    .attr('alignment-baseline', 'middle')
    .style('opacity', 0)


  // Create a rect on top of the svg area: this rectangle recovers mouse position
  lineChart
    .append('rect')
    .style("fill", "none")
    .style("pointer-events", "all")
    .attr('width', width)
    .attr('height', height)
    .on('mouseover', mouseover)
    .on('mousemove', mousemove)
    .on('mouseout', mouseout);

  function mouseover() {
    focusLine.style("opacity", 1)
    focusCircle.style("opacity", 1)
    focusText.style("opacity", 1)
  }

  var bisect = d3.bisector(function (d) { return d.blockNumber; }).right;

  function mousemove(event) {
    // recover coordinate we need
    var pointerX = d3.pointer(event)[0]
    var x0 = x.invert(pointerX);
    var i = bisect(roi, x0);

    selectedData = roi[i - 1]
    focusLine
      .attr("d", function () {
        var d = "M" + x(selectedData.blockNumber) + "," + 0;
        d += " " + x(selectedData.blockNumber) + "," + height;
        return d;
      })
    focusCircle
      .attr('transform', `translate(${x(selectedData.blockNumber)},${y(selectedData.roi)})`)
    focusText
      .attr('transform', `translate(${x(selectedData.blockNumber)},${y(selectedData.roi)})`)
      .text(((selectedData.roi - 1) * 100).toFixed(2) + '%')
  }
  function mouseout() {
    focusLine.style("opacity", 0)
    focusCircle.style("opacity", 0)
    focusText.style("opacity", 0)
  }

}